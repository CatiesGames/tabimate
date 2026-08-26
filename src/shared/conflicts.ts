// 行程時間衝突偵測 + 住宿跨夜語意:前端警示與 agent 的 get_itinerary 共用同一套規則。
import type { Day, Stop } from "./types";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** 住宿跨夜:lodging 的 endTime 代表「隔天退房時間」,早於 startTime 是合法的。 */
export function isOvernightLodging(stop: Stop): boolean {
  return (
    stop.category === "lodging" &&
    !!stop.startTime &&
    !!stop.endTime &&
    toMin(stop.endTime) < toMin(stop.startTime)
  );
}

/**
 * 白天回飯店休息(如 14:00-16:00 回去放戰利品/午休):
 * lodging 但起訖在同一天內(endTime > startTime)。這種卡是普通行程,
 * 不代表過夜、不啟動續住判定。過夜住宿 = 跨夜(end < start)或未填退房。
 */
export function isDayVisitLodging(stop: Stop): boolean {
  return (
    stop.category === "lodging" &&
    !!stop.startTime &&
    !!stop.endTime &&
    toMin(stop.endTime) > toMin(stop.startTime)
  );
}

export type CarryOverLodging = {
  stop: Stop;
  /** 這天是退房日(顯示退房時間;之後這間就不再延續)。 */
  isCheckoutDay: boolean;
};

/**
 * 某一天的「續住住宿」:依 nights(住幾晚)判斷 —
 * 入住日 D、住 n 晚 → D+1 ~ D+n 都回傳這間;D+n 是退房日。
 * 同天有多間符合時取入住日最近的一間。
 */
export function carryOverLodging(
  days: Day[],
  stops: Stop[],
  dayId: string,
): CarryOverLodging | null {
  const ordered = [...days].sort((a, b) => a.position - b.position);
  const idx = ordered.findIndex((d) => d.id === dayId);
  if (idx <= 0) return null;
  const dayIndexOf = new Map(ordered.map((d, i) => [d.id, i]));
  let best: { stop: Stop; checkinIdx: number } | null = null;
  for (const s of stops) {
    if (s.category !== "lodging" || isDayVisitLodging(s)) continue;
    const checkinIdx = dayIndexOf.get(s.dayId);
    if (checkinIdx == null) continue;
    const nights = Math.max(1, s.nights ?? 1);
    if (idx > checkinIdx && idx <= checkinIdx + nights) {
      if (!best || checkinIdx > best.checkinIdx) best = { stop: s, checkinIdx };
    }
  }
  if (!best) return null;
  const nights = Math.max(1, best.stop.nights ?? 1);
  return { stop: best.stop, isCheckoutDay: idx === best.checkinIdx + nights };
}

/**
 * 回傳「時間與前後順序衝突」的 stopId 集合。
 * 規則(按每天的排列順序):
 * - stop 自身 endTime < startTime → 衝突;但住宿(lodging)視為跨夜合法
 * - stop 的 startTime 早於前一個有時間的 stop 的結束(無 endTime 則以 startTime 計)→ 衝突
 * - 跨天:當天第一個 stop 早於「續住住宿的退房時間」→ 衝突
 * 沒填時間的 stop 不參與判斷。
 */
export function detectTimeConflicts(days: Day[], stops: Stop[]): Set<string> {
  const conflicts = new Set<string>();
  for (const day of days) {
    const ordered = stops
      .filter((s) => s.dayId === day.id)
      .sort((a, b) => a.position - b.position);
    // 當天起點 = 離開住宿的時間:中間天用 day.lodgingDepartTime,退房日用住宿退房時間
    const carry = carryOverLodging(days, stops, day.id);
    const departTime =
      carry &&
      (day.lodgingDepartTime ??
        (carry.isCheckoutDay && isOvernightLodging(carry.stop) ? carry.stop.endTime : null));
    let prevEnd: number | null = departTime ? toMin(departTime) : null;
    for (const stop of ordered) {
      if (!stop.startTime) continue;
      const start = toMin(stop.startTime);
      const overnight = isOvernightLodging(stop);
      if (!overnight && stop.endTime && toMin(stop.endTime) < start) {
        conflicts.add(stop.id);
      }
      if (prevEnd != null && start < prevEnd) conflicts.add(stop.id);
      // 跨夜住宿的 endTime 屬於隔天,不推進當天的時間鏈
      prevEnd = Math.max(
        prevEnd ?? 0,
        stop.endTime && !overnight ? toMin(stop.endTime) : start,
      );
    }
    // 「晚上回住宿」的天(續住中間天,或入住日住宿不在末位=先放行李再出門):
    // 設定了回到時間時,最後一個有時間的行程結束得比它晚 → 衝突
    const ownLodging = [...ordered]
      .reverse()
      .find((s2) => s2.category === "lodging" && !isDayVisitLodging(s2));
    const returnsToLodging =
      (carry && !carry.isCheckoutDay) ||
      (ownLodging && ordered.indexOf(ownLodging) < ordered.length - 1);
    if (returnsToLodging && day.lodgingReturnTime) {
      const last = [...ordered].reverse().find((s) => s.startTime);
      if (last) {
        const end =
          last.endTime && !isOvernightLodging(last) ? toMin(last.endTime) : toMin(last.startTime!);
        if (end > toMin(day.lodgingReturnTime)) conflicts.add(last.id);
      }
    }
  }
  return conflicts;
}
