import { describe, expect, test } from "bun:test";

import {
  applyOperations,
  ChangesetError,
  globalStopOrder,
  type ApplyMeta,
  type ItinDoc,
  type Operation,
} from "./changeset";

let idCounter = 0;
const meta = (): ApplyMeta => ({
  tripId: "T1",
  actorUserId: "u1",
  now: 1000,
  newId: () => `id${++idCounter}`,
});

const emptyDoc = (): ItinDoc => ({
  trip: { title: "測試行程", destination: null, startDate: null },
  days: [],
  stops: [],
  legs: [],
});

function apply(doc: ItinDoc, ops: Operation[]) {
  return applyOperations(doc, ops, meta());
}

function seedDoc(): ItinDoc {
  // Day1: A(0), B(1);Day2: C(0)
  const { doc } = apply(emptyDoc(), [
    { op: "add_day", tempId: "d1" },
    { op: "add_day", tempId: "d2" },
    { op: "add_stop", tempId: "a", dayId: "$d1", name: "A" },
    { op: "add_stop", tempId: "b", dayId: "$d1", name: "B" },
    { op: "add_stop", tempId: "c", dayId: "$d2", name: "C" },
  ]);
  return doc;
}

const stopByName = (doc: ItinDoc, name: string) => {
  const s = doc.stops.find((x) => x.name === name);
  if (!s) throw new Error(`no stop ${name}`);
  return s;
};

describe("applyOperations", () => {
  test("temp id 前向引用:add_day + add_stop", () => {
    const { doc, tempMap } = apply(emptyDoc(), [
      { op: "add_day", tempId: "d1", title: "第一天" },
      { op: "add_stop", tempId: "s1", dayId: "$d1", name: "淺草寺", category: "sight" },
    ]);
    expect(doc.days).toHaveLength(1);
    expect(doc.stops).toHaveLength(1);
    expect(doc.stops[0].dayId).toBe(tempMap.d1);
    expect(doc.stops[0].category).toBe("sight");
  });

  test("position clamp + 密集重排", () => {
    const doc = seedDoc();
    const { doc: after } = apply(doc, [
      { op: "add_stop", dayId: doc.days[0].id, name: "X", position: 999 },
    ]);
    const day1Stops = after.stops
      .filter((s) => s.dayId === doc.days[0].id)
      .sort((a, b) => a.position - b.position);
    expect(day1Stops.map((s) => s.name)).toEqual(["A", "B", "X"]);
    expect(day1Stops.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  test("move_stop 跨天", () => {
    const doc = seedDoc();
    const b = stopByName(doc, "B");
    const { doc: after } = apply(doc, [
      { op: "move_stop", stopId: b.id, toDayId: doc.days[1].id, position: 0 },
    ]);
    const day2 = after.stops
      .filter((s) => s.dayId === doc.days[1].id)
      .sort((a, b2) => a.position - b2.position);
    expect(day2.map((s) => s.name)).toEqual(["B", "C"]);
    // 原天密集重排
    const day1 = after.stops.filter((s) => s.dayId === doc.days[0].id);
    expect(day1.map((s) => s.position)).toEqual([0]);
  });

  test("set_leg upsert + 跨天 leg 合法", () => {
    const doc = seedDoc();
    const b = stopByName(doc, "B");
    // B 是 Day1 最後一站,下一站是 Day2 的 C(夜巴情境)
    const { doc: after } = apply(doc, [
      { op: "set_leg", fromStopId: b.id, mode: "transit", durationMin: 480 },
    ]);
    expect(after.legs).toHaveLength(1);
    expect(after.legs[0].toStopId).toBe(stopByName(doc, "C").id);
    // upsert:再 set 一次不會多一條
    const { doc: after2 } = apply(after, [
      { op: "set_leg", fromStopId: b.id, mode: "flight" },
    ]);
    expect(after2.legs).toHaveLength(1);
    expect(after2.legs[0].mode).toBe("flight");
  });

  test("最後一站不能有 leg", () => {
    const doc = seedDoc();
    const c = stopByName(doc, "C");
    expect(() => apply(doc, [{ op: "set_leg", fromStopId: c.id, mode: "walk" }])).toThrow(
      ChangesetError,
    );
  });

  test("重排後不再相鄰的 leg 自動刪除", () => {
    const doc = seedDoc();
    const a = stopByName(doc, "A");
    const b = stopByName(doc, "B");
    const { doc: withLeg } = apply(doc, [
      { op: "set_leg", fromStopId: a.id, mode: "walk", durationMin: 10 },
    ]);
    expect(withLeg.legs).toHaveLength(1);
    // 把 B 移到 Day2 末尾 → A 的下一站變成 C,A→B leg 應被清掉
    const { doc: after } = apply(withLeg, [
      { op: "move_stop", stopId: b.id, toDayId: doc.days[1].id, position: 99 },
    ]);
    expect(after.legs).toHaveLength(0);
  });

  test("缺 ref 整包 abort(輸入不被改動)", () => {
    const doc = seedDoc();
    expect(() =>
      apply(doc, [
        { op: "update_stop", stopId: stopByName(doc, "A").id, patch: { name: "改了" } },
        { op: "remove_stop", stopId: "不存在" },
      ]),
    ).toThrow(ChangesetError);
    expect(stopByName(doc, "A").name).toBe("A");
  });

  test("update_stop 預約欄位", () => {
    const doc = seedDoc();
    const a = stopByName(doc, "A");
    const { doc: after } = apply(doc, [
      {
        op: "update_stop",
        stopId: a.id,
        patch: {
          bookingType: "reservation_required",
          bookingStatus: "booked",
          booking: { platform: "官網", confirmationCode: "GHI-1024", deadline: "2026-10-01" },
        },
      },
    ]);
    const updated = stopByName(after, "A");
    expect(updated.bookingType).toBe("reservation_required");
    expect(updated.bookingStatus).toBe("booked");
    expect(updated.booking?.confirmationCode).toBe("GHI-1024");
  });

  test("時間格式驗證", () => {
    const doc = seedDoc();
    expect(() =>
      apply(doc, [
        { op: "update_stop", stopId: stopByName(doc, "A").id, patch: { startTime: "25:00" } },
      ]),
    ).toThrow(ChangesetError);
  });

  test("remove_day 連帶清 stops 與 legs", () => {
    const doc = seedDoc();
    const a = stopByName(doc, "A");
    const { doc: withLeg } = apply(doc, [
      { op: "set_leg", fromStopId: a.id, mode: "walk" },
    ]);
    const { doc: after } = apply(withLeg, [{ op: "remove_day", dayId: doc.days[0].id }]);
    expect(after.days).toHaveLength(1);
    expect(after.stops.map((s) => s.name)).toEqual(["C"]);
    expect(after.legs).toHaveLength(0);
  });

  test("move_day 重排 + 全域順序反映", () => {
    const doc = seedDoc();
    const { doc: after } = apply(doc, [{ op: "move_day", dayId: doc.days[1].id, position: 0 }]);
    expect(globalStopOrder(after).map((s) => s.name)).toEqual(["C", "A", "B"]);
  });

  test("改時間/移動 → 相鄰 leg 標記需重新確認;set_leg 清除", () => {
    const doc = seedDoc();
    const a = stopByName(doc, "A");
    const { doc: withLeg } = apply(doc, [
      { op: "set_leg", fromStopId: a.id, mode: "walk", durationMin: 10 },
    ]);
    expect(withLeg.legs[0].needsReview).toBe(false);
    // 改 B 的時間(leg 的 toStop)→ 標記
    const b = stopByName(withLeg, "B");
    const { doc: afterTime } = apply(withLeg, [
      { op: "update_stop", stopId: b.id, patch: { startTime: "10:00" } },
    ]);
    expect(afterTime.legs[0].needsReview).toBe(true);
    // 重新 set_leg → 清除
    const { doc: reset } = apply(afterTime, [
      { op: "set_leg", fromStopId: a.id, mode: "transit" },
    ]);
    expect(reset.legs[0].needsReview).toBe(false);
    // 改備註(非時間)不觸發
    const { doc: notesOnly } = apply(reset, [
      { op: "update_stop", stopId: b.id, patch: { notes: "hi" } },
    ]);
    expect(notesOnly.legs[0].needsReview).toBe(false);
  });

  test("交通購票:set_leg 帶購票欄位;set_leg_booking 只改狀態不清 needsReview", () => {
    const doc = seedDoc();
    const a = stopByName(doc, "A");
    const { doc: withLeg } = apply(doc, [
      {
        op: "set_leg",
        fromStopId: a.id,
        mode: "transit",
        bookingType: "ticket_required",
        booking: { url: "https://example.com/ticket" },
      },
    ]);
    expect(withLeg.legs[0].bookingType).toBe("ticket_required");
    expect(withLeg.legs[0].booking?.url).toBe("https://example.com/ticket");
    // 相鄰時間變更 → needsReview;set_leg_booking 改狀態不會清掉它
    const b = stopByName(withLeg, "B");
    const { doc: flagged } = apply(withLeg, [
      { op: "update_stop", stopId: b.id, patch: { startTime: "11:00" } },
      { op: "set_leg_booking", fromStopId: a.id, bookingStatus: "booked" },
    ]);
    expect(flagged.legs[0].bookingStatus).toBe("booked");
    expect(flagged.legs[0].needsReview).toBe(true);
    // 沒有交通段的地點 → 錯誤
    expect(() =>
      apply(doc, [{ op: "set_leg_booking", fromStopId: b.id, bookingStatus: "booked" }]),
    ).toThrow();
  });

  test("快照往返 id 穩定(回滾基礎)", () => {
    const doc = seedDoc();
    const snapshot = JSON.parse(JSON.stringify(doc)) as ItinDoc;
    // 大改之後,拿快照 re-apply(模擬回滾 persist)不會動 id
    const { doc: mutated } = apply(doc, [
      { op: "remove_stop", stopId: stopByName(doc, "B").id },
      { op: "add_stop", dayId: doc.days[0].id, name: "新點" },
    ]);
    expect(mutated.stops.find((s) => s.name === "B")).toBeUndefined();
    expect(snapshot.stops.map((s) => s.id).sort()).toEqual(
      doc.stops.map((s) => s.id).sort(),
    );
  });
});

import { effectiveDurationMin } from "./changeset";

describe("effectiveDurationMin(交通時長單一真相)", () => {
  test("起訖齊全:以推導為準,忽略不一致的 durationMin", () => {
    expect(effectiveDurationMin({ durationMin: 7, departureTime: "17:00", arrivalTime: "17:10" })).toBe(10);
  });
  test("跨午夜", () => {
    expect(effectiveDurationMin({ durationMin: null, departureTime: "23:50", arrivalTime: "00:20" })).toBe(30);
  });
  test("缺起訖:沿用 durationMin", () => {
    expect(effectiveDurationMin({ durationMin: 7, departureTime: null, arrivalTime: null })).toBe(7);
  });
});
