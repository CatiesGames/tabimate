// 日層級住宿頭尾交通(day.lodgingMorningLeg/EveningLeg)的共用解析:
// 時間軸卡片、交通詳細卡、地圖 fit 都從這裡取得同一份「住宿↔相鄰行程」脈絡,
// 讓它與一般交通(legs 表)在 UI 上的行為完全一致(選取 → 底部詳細卡)。
import {
  carryOverLodging,
  isOvernightLodging,
  primaryLodgingOf,
} from "@/shared/conflicts";
import type { Operation } from "@/shared/changeset";
import type { CarryLeg, Day, Leg, Stop } from "@/shared/types";

export type CarryEdge = "morning" | "evening";

/** 選取 id:與一般交通的 selectedLegId(=fromStopId)共用同一個欄位。 */
export function carryLegSelectionId(dayId: string, edge: CarryEdge): string {
  return `carry:${dayId}:${edge}`;
}

export function parseCarryLegSelection(
  id: string,
): { dayId: string; edge: CarryEdge } | null {
  if (!id.startsWith("carry:")) return null;
  const [, dayId, edge] = id.split(":");
  if (!dayId || (edge !== "morning" && edge !== "evening")) return null;
  return { dayId, edge };
}

export type CarryLegContext = {
  day: Day;
  /** 這段交通連著的住宿。 */
  lodging: Stop;
  /** 當天相鄰的行程(morning=第一個,evening=最後一個)。 */
  adjacent: Stop;
  /** 起訖(住宿端帶入離開/回到時間,供編輯器時間預設):morning=住宿→行程,evening=行程→住宿。 */
  from: Stop;
  to: Stop;
  carryLeg: CarryLeg | null;
  /** 套進一般交通 UI 的假 Leg(無獨立 id/booking)。 */
  fakeLeg: Leg | null;
};

export function resolveCarryLeg(
  doc: { days: Day[]; stops: Stop[] },
  dayId: string,
  edge: CarryEdge,
): CarryLegContext | null {
  const day = doc.days.find((d) => d.id === dayId);
  if (!day) return null;
  const dayStops = doc.stops
    .filter((s) => s.dayId === dayId)
    .sort((a, b) => a.position - b.position);
  const carry = carryOverLodging(doc.days, doc.stops, dayId);

  let lodging: Stop | null;
  let adjacent: Stop | null;
  let from: Stop | null = null;
  let to: Stop | null = null;
  if (edge === "morning") {
    lodging = carry?.stop ?? null;
    adjacent = dayStops[0] ?? null;
    if (lodging && carry) {
      const departValue = carry.isCheckoutDay
        ? isOvernightLodging(lodging)
          ? lodging.endTime
          : null
        : day.lodgingDepartTime;
      from = { ...lodging, startTime: null, endTime: departValue };
      to = adjacent;
    }
  } else {
    // 一天的結尾回住宿:續住中間天,或入住日主卡不在末位(先放行李)
    lodging = carry && !carry.isCheckoutDay ? carry.stop : null;
    if (!lodging) {
      const primary = primaryLodgingOf(doc.days, doc.stops, dayId);
      lodging = primary && dayStops[dayStops.length - 1]?.id !== primary.id ? primary : null;
    }
    adjacent = dayStops[dayStops.length - 1] ?? null;
    if (lodging) {
      from = adjacent;
      to = { ...lodging, startTime: day.lodgingReturnTime, endTime: null };
    }
  }
  if (!lodging || !adjacent || !from || !to) return null;

  const carryLeg = edge === "morning" ? day.lodgingMorningLeg : day.lodgingEveningLeg;
  const fakeLeg: Leg | null = carryLeg
    ? {
        id: carryLegSelectionId(day.id, edge),
        tripId: day.tripId,
        fromStopId: "",
        toStopId: "",
        distanceM: null,
        needsReview: false,
        bookingType: "none",
        bookingStatus: "not_booked",
        booking: null,
        updatedAt: 0,
        ...carryLeg,
      }
    : null;
  return { day, lodging, adjacent, from, to, carryLeg, fakeLeg };
}

/** 儲存/清除這段交通的 op 與版本描述。 */
export function carryLegSaveOp(
  ctx: Pick<CarryLegContext, "day" | "lodging" | "adjacent">,
  edge: CarryEdge,
  p: CarryLeg | null,
): { ops: Operation[]; label: string } {
  const field = edge === "morning" ? "lodgingMorningLeg" : "lodgingEveningLeg";
  return {
    ops: [{ op: "update_day", dayId: ctx.day.id, patch: { [field]: p } }],
    label: p
      ? edge === "morning"
        ? `調整 ${ctx.lodging.name} → ${ctx.adjacent.name} 交通`
        : `調整 ${ctx.adjacent.name} → ${ctx.lodging.name} 交通`
      : "清除住宿交通",
  };
}
