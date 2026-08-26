import { describe, expect, test } from "bun:test";

import { carryOverLodging, detectTimeConflicts, isOvernightLodging, primaryLodgingOf } from "./conflicts";
import type { Day, Stop } from "./types";

const day = (id: string, position: number): Day => ({
  id,
  tripId: "T",
  position,
  title: null,
  note: "",
  lodgingDepartTime: null,
  lodgingReturnTime: null,
  lodgingMorningLeg: null,
  lodgingEveningLeg: null,
});

const stop = (
  id: string,
  dayId: string,
  position: number,
  startTime: string | null,
  endTime: string | null = null,
  category: Stop["category"] = "sight",
): Stop => ({
  id,
  dayId,
  position,
  name: id,
  category,
  startTime,
  endTime,
  placeId: null,
  lat: null,
  lng: null,
  address: null,
  place: null,
  notes: "",
  verifyStatus: "unverified",
  verifySources: [],
  verifiedAt: null,
  bookingType: "none",
  bookingStatus: "not_booked",
  booking: null,
  nights: 1,
  updatedAt: 0,
  updatedByUserId: null,
});

const lodgingN = (id: string, dayId: string, nights: number, start: string, end: string): Stop => ({
  ...stop(id, dayId, 99, start, end, "lodging"),
  nights,
});

describe("住宿跨夜", () => {
  const days = [day("d1", 0), day("d2", 1), day("d3", 2)];

  test("lodging endTime < startTime = 跨夜,不算衝突", () => {
    const stops = [
      stop("a", "d1", 0, "18:00"),
      stop("hotel", "d1", 1, "20:00", "09:30", "lodging"),
    ];
    expect(isOvernightLodging(stops[1])).toBe(true);
    expect(detectTimeConflicts(days, stops).size).toBe(0);
  });

  test("非住宿 endTime < startTime 仍是衝突", () => {
    const stops = [stop("a", "d1", 0, "18:00", "09:00")];
    expect(detectTimeConflicts(days, stops).has("a")).toBe(true);
  });

  test("隔天首個行程早於退房時間 → 衝突", () => {
    const stops = [
      stop("hotel", "d1", 0, "20:00", "10:00", "lodging"),
      stop("b", "d2", 0, "09:00"),
    ];
    expect(detectTimeConflicts(days, stops).has("b")).toBe(true);
    // 退房後出發就沒事
    const ok = [
      stop("hotel", "d1", 0, "20:00", "10:00", "lodging"),
      stop("b", "d2", 0, "10:30"),
    ];
    expect(detectTimeConflicts(days, ok).size).toBe(0);
  });

  test("carryOverLodging:依 nights 延續,遇到新住宿就換", () => {
    const stops = [
      lodgingN("hotelA", "d1", 1, "20:00", "09:30"),
      stop("x", "d2", 0, "11:00"),
      lodgingN("hotelB", "d2", 1, "21:00", "10:00"),
      stop("y", "d3", 0, "10:30"),
    ];
    expect(carryOverLodging(days, stops, "d1")).toBeNull();
    const d2 = carryOverLodging(days, stops, "d2");
    expect(d2?.stop.id).toBe("hotelA");
    expect(d2?.isCheckoutDay).toBe(true);
    expect(carryOverLodging(days, stops, "d3")?.stop.id).toBe("hotelB");
  });

  test("carryOverLodging:nights=2 連泊,中間天非退房日", () => {
    const stops = [lodgingN("hotelA", "d1", 2, "20:00", "09:30")];
    const d2 = carryOverLodging(days, stops, "d2");
    expect(d2?.stop.id).toBe("hotelA");
    expect(d2?.isCheckoutDay).toBe(false);
    const d3 = carryOverLodging(days, stops, "d3");
    expect(d3?.stop.id).toBe("hotelA");
    expect(d3?.isCheckoutDay).toBe(true);
  });

  test("nights=1 不延續到第三天", () => {
    const stops = [lodgingN("hotelA", "d1", 1, "20:00", "09:30")];
    expect(carryOverLodging(days, stops, "d3")).toBeNull();
  });

  test("中間天首行程早於退房時間不算衝突(還住著)", () => {
    const stops = [
      lodgingN("hotel", "d1", 2, "20:00", "10:00"),
      stop("b", "d2", 0, "08:00"), // 中間天,自由活動
      stop("c", "d3", 0, "09:00"), // 退房日早於 10:00 → 衝突
    ];
    const conflicts = detectTimeConflicts(days, stops);
    expect(conflicts.has("b")).toBe(false);
    expect(conflicts.has("c")).toBe(true);
  });

  test("中間天設定出發時間:首行程早於出發 → 衝突", () => {
    const stops = [
      lodgingN("hotel", "d1", 2, "20:00", "10:00"),
      stop("b", "d2", 0, "09:00"),
    ];
    const d2 = { ...days[1], lodgingDepartTime: "09:30" };
    expect(detectTimeConflicts([days[0], d2, days[2]], stops).has("b")).toBe(true);
    const ok = { ...days[1], lodgingDepartTime: "08:30" };
    expect(detectTimeConflicts([days[0], ok, days[2]], stops).has("b")).toBe(false);
  });

  test("中間天設定回到時間:最後行程結束晚於回到 → 衝突", () => {
    const stops = [
      lodgingN("hotel", "d1", 2, "20:00", "10:00"),
      stop("b", "d2", 0, "18:00", "21:30"),
    ];
    const d2 = { ...days[1], lodgingReturnTime: "21:00" };
    expect(detectTimeConflicts([days[0], d2, days[2]], stops).has("b")).toBe(true);
    const ok = { ...days[1], lodgingReturnTime: "22:00" };
    expect(detectTimeConflicts([days[0], ok, days[2]], stops).has("b")).toBe(false);
  });

  test("白天回飯店休息(起訖同日)不是過夜:不啟動續住、不影響原續住鏈", () => {
    const stops = [
      lodgingN("hotelA", "d1", 2, "20:00", "09:30"), // 真住宿:D1 入住住 2 晚
      { ...stop("rest", "d2", 1, "14:00", "16:00", "lodging") }, // D2 中午回飯店休息
      stop("x", "d2", 0, "10:00", "12:00"),
    ];
    // D2/D3 的續住仍指向 hotelA,不會被休息卡搶走
    expect(carryOverLodging(days, stops, "d2")?.stop.id).toBe("hotelA");
    expect(carryOverLodging(days, stops, "d3")?.stop.id).toBe("hotelA");
    // 休息卡自身 end>start 不算自身衝突
    expect(detectTimeConflicts(days, stops).has("rest")).toBe(false);
  });

  test("入住日先放行李(住宿在中間):回到時間晚於最後行程才過", () => {
    const stops = [
      stop("a", "d1", 0, "13:00", "14:30"),
      stop("hotel", "d1", 1, "15:00", "10:00", "lodging"), // 放行李
      stop("b", "d1", 2, "18:00", "21:30"), // 晚上行程
    ];
    const dLate = { ...days[0], lodgingReturnTime: "21:00" };
    expect(detectTimeConflicts([dLate, days[1], days[2]], stops).has("b")).toBe(true);
    const dOk = { ...days[0], lodgingReturnTime: "22:00" };
    expect(detectTimeConflicts([dOk, days[1], days[2]], stops).has("b")).toBe(false);
  });

  test("主卡=入住日第一張:之後同天的同飯店卡是輕量卡,nights 從主卡讀", () => {
    const stops = [
      { ...lodgingN("main", "d1", 2, "15:00", "09:30"), position: 1 }, // 15:00 放行李(第一張)
      stop("evening", "d1", 2, "18:00", "20:00"),
      { ...stop("back", "d1", 3, "20:30", null, "lodging") }, // 晚上回飯店(第二張)
    ];
    expect(primaryLodgingOf(days, stops, "d1")?.id).toBe("main");
    // 續住依主卡 nights=2:d2 中間天、d3 退房日
    expect(carryOverLodging(days, stops, "d2")?.stop.id).toBe("main");
    expect(carryOverLodging(days, stops, "d3")?.isCheckoutDay).toBe(true);
  });

  test("續住中間天沒有主卡(當天 lodging 全是回飯店卡);退房日可換旅館", () => {
    const stops = [
      lodgingN("hotelA", "d1", 1, "20:00", "10:00"), // d2 退房
      lodgingN("hotelB", "d2", 1, "15:00", "09:00"), // d2 換旅館
    ];
    expect(primaryLodgingOf(days, stops, "d2")?.id).toBe("hotelB");
    expect(carryOverLodging(days, stops, "d3")?.stop.id).toBe("hotelB");
  });

  test("跨夜住宿的 endTime 不影響當天後續(住宿不在末位)", () => {
    const stops = [
      stop("hotel", "d1", 0, "15:00", "09:00", "lodging"), // 先放行李
      stop("a", "d1", 1, "16:00"),
    ];
    expect(detectTimeConflicts(days, stops).size).toBe(0);
  });
});
