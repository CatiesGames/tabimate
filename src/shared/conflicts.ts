// 行程時間衝突偵測 + 住宿語意:前端警示與 agent 的 get_itinerary 共用同一套規則。
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
 * 逐天決定「住宿主卡」(dayId → 主卡):
 * - 主卡 = 這間飯店的第一張卡(入住日排序最前的 lodging),承載 check-in/退房/nights 設定
 * - 續住中間天沒有主卡(那天出現的 lodging 都是「回飯店」輕量卡)
 * - 退房日可以有新主卡(換旅館日)
 * 逐天序列計算:某天是否為續住中間天,只由更早天已決定的主卡決定,無循環。
 */
export function computePrimaryLodging(days: Day[], stops: Stop[]): Map<string, Stop> {
  const orderedDays = [...days].sort((a, b) => a.position - b.position);
  const dayIndexOf = new Map(orderedDays.map((d, i) => [d.id, i]));
  const primaries = new Map<string, Stop>();
  for (let i = 0; i < orderedDays.length; i++) {
    const day = orderedDays[i];
    let carrying = false;
    for (const [dId, p] of primaries) {
      const ci = dayIndexOf.get(dId)!;
      const nights = Math.max(1, p.nights ?? 1);
      if (i > ci && i < ci + nights) {
        carrying = true; // 續住中間天(退房日 i === ci+nights 不算,可換旅館)
        break;
      }
    }
    if (carrying) continue;
    const first = stops
      .filter((s) => s.dayId === day.id && s.category === "lodging")
      .sort((a, b) => a.position - b.position)[0];
    if (first) primaries.set(day.id, first);
  }
  return primaries;
}

/** 某一天的住宿主卡(沒有=null;續住中間天恆為 null)。 */
export function primaryLodgingOf(days: Day[], stops: Stop[], dayId: string): Stop | null {
  return computePrimaryLodging(days, stops).get(dayId) ?? null;
}

/**
 * 回飯店輕量卡:主卡以外的 lodging(中途回飯店休息/放戰利品/續住日回飯店)。
 * 是普通行程卡:不代表過夜、不啟動續住判定、詳情沒有連泊設定。
 */
export function isSecondaryLodging(days: Day[], stops: Stop[], stop: Stop): boolean {
  if (stop.category !== "lodging") return false;
  return computePrimaryLodging(days, stops).get(stop.dayId)?.id !== stop.id;
}

export type CarryOverLodging = {
  stop: Stop;
  /** 這天是退房日(顯示退房時間;之後這間就不再延續)。 */
  isCheckoutDay: boolean;
};

/**
 * 某一天的「續住住宿」:依主卡的 nights(住幾晚)判斷 —
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
  for (const s of computePrimaryLodging(days, stops).values()) {
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
 * - stop 自身 endTime < startTime → 衝突;但住宿主卡視為跨夜合法(endTime=退房時間)
 * - stop 的 startTime 早於前一個有時間的 stop 的結束(無 endTime 則以 startTime 計)→ 衝突
 * - 跨天:當天第一個 stop 早於「離開住宿時間/續住退房時間」→ 衝突
 * - 晚上回住宿的天設定了回到時間:最後行程結束得比它晚 → 衝突
 * 沒填時間的 stop 不參與判斷。
 */
export function detectTimeConflicts(days: Day[], stops: Stop[]): Set<string> {
  const conflicts = new Set<string>();
  const primaries = computePrimaryLodging(days, stops);
  for (const day of days) {
    const ordered = stops
      .filter((s) => s.dayId === day.id)
      .sort((a, b) => a.position - b.position);
    const primary = primaries.get(day.id) ?? null;
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
      // 跨夜豁免只給主卡(回飯店輕量卡 end<start 是輸入錯誤)
      const overnight = isOvernightLodging(stop) && stop.id === primary?.id;
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
    // 「晚上回住宿」的天(續住中間天,或入住日主卡不在末位=先放行李再出門):
    // 設定了回到時間時,最後一個有時間的行程結束得比它晚 → 衝突
    const returnsToLodging =
      (carry && !carry.isCheckoutDay) ||
      (primary && ordered.indexOf(primary) < ordered.length - 1);
    if (returnsToLodging && day.lodgingReturnTime) {
      const last = [...ordered].reverse().find((s) => s.startTime);
      if (last) {
        const end =
          last.endTime && !(isOvernightLodging(last) && last.id === primary?.id)
            ? toMin(last.endTime)
            : toMin(last.startTime!);
        if (end > toMin(day.lodgingReturnTime)) conflicts.add(last.id);
      }
    }
  }
  return conflicts;
}

/**
 * 當天的住宿錨點是否離「當天主要活動區」很遠(如遠征另一座城市):
 * 是的話地圖視野自動不遷就住宿(標記照畫)。門檻=活動區對角線 1.5 倍,至少 5km,
 * 所以住宿在活動區附近(同城)一定納入、跨城遠征一定排除;每天各自判定。
 */
export function lodgingFarFromDay(
  lodging: Stop,
  stops: Stop[],
  dayId: string,
): boolean {
  if (lodging.lat == null || lodging.lng == null) return false;
  const pts = stops.filter(
    (s) =>
      s.dayId === dayId &&
      s.lat != null &&
      s.lng != null &&
      !s.excludeFromFit &&
      s.id !== lodging.id,
  );
  if (pts.length === 0) return false;
  const lats = pts.map((s) => s.lat!);
  const lngs = pts.map((s) => s.lng!);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
  const kmPerLat = 111;
  const kmPerLng = 111 * Math.cos((cLat * Math.PI) / 180);
  const diagKm = Math.hypot((maxLat - minLat) * kmPerLat, (maxLng - minLng) * kmPerLng);
  const distKm = Math.hypot((lodging.lat - cLat) * kmPerLat, (lodging.lng - cLng) * kmPerLng);
  return distKm > Math.max(1.5 * diagKm, 5);
}
