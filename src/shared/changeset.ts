// 唯一的行程變更語言:agent 提案與使用者直接編輯共用同一個 apply 引擎。
// 引擎是純函式(不碰 DB),gateway 負責載入/寫回,測試不需要資料庫。
import {
  BOOKING_STATUSES,
  BOOKING_TYPES,
  LEG_MODES,
  STOP_CATEGORIES,
  VERIFY_STATUSES,
  type BookingStatus,
  type BookingType,
  type LegMode,
  type StopCategory,
  type VerifyStatus,
} from "./config";
import type {
  BookingInfo,
  CarryLeg,
  Day,
  Leg,
  PlaceInfo,
  Stop,
  TransitDetail,
  VerifySource,
} from "./types";

export type Ref = string; // 真實 id 或 "$tempId"

export type StopPatch = Partial<{
  name: string;
  category: StopCategory;
  startTime: string | null;
  endTime: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  place: PlaceInfo | null;
  notes: string;
  bookingType: BookingType;
  bookingStatus: BookingStatus;
  booking: BookingInfo | null;
  nights: number;
}>;

export type Operation =
  | { op: "add_day"; tempId?: string; position?: number; title?: string; note?: string }
  | {
      op: "update_day";
      dayId: Ref;
      patch: Partial<{
        title: string | null;
        note: string;
        lodgingDepartTime: string | null;
        lodgingReturnTime: string | null;
        lodgingMorningLeg: CarryLeg | null;
        lodgingEveningLeg: CarryLeg | null;
      }>;
    }
  | { op: "move_day"; dayId: Ref; position: number }
  | { op: "remove_day"; dayId: Ref }
  | {
      op: "add_stop";
      tempId?: string;
      dayId: Ref;
      position?: number;
      name: string;
      category?: StopCategory;
      startTime?: string | null;
      endTime?: string | null;
      placeId?: string | null;
      lat?: number | null;
      lng?: number | null;
      address?: string | null;
      notes?: string;
      bookingType?: BookingType;
      bookingStatus?: BookingStatus;
      booking?: BookingInfo | null;
      nights?: number;
    }
  | { op: "update_stop"; stopId: Ref; patch: StopPatch }
  | { op: "move_stop"; stopId: Ref; toDayId: Ref; position: number }
  | { op: "remove_stop"; stopId: Ref }
  | {
      op: "set_leg";
      fromStopId: Ref;
      mode: LegMode;
      durationMin?: number | null;
      distanceM?: number | null;
      departureTime?: string | null;
      arrivalTime?: string | null;
      transit?: TransitDetail | null;
      notes?: string;
    }
  | { op: "remove_leg"; fromStopId: Ref }
  | { op: "set_verification"; stopId: Ref; status: VerifyStatus; sources: VerifySource[] }
  | {
      op: "update_trip";
      patch: Partial<{
        title: string;
        destination: string | null;
        startDate: string | null;
      }>;
    };

export type TripDocMeta = {
  title: string;
  destination: string | null;
  startDate: string | null;
};

/** 引擎操作的記憶體文件(=版本快照的內容)。 */
export type ItinDoc = {
  trip: TripDocMeta;
  days: Day[];
  stops: Stop[];
  legs: Leg[];
};

export type ApplyMeta = {
  tripId: string;
  actorUserId: string | null;
  now: number;
  newId: () => string;
};

export type ApplyScope = { dayIds: Set<string>; stopIds: Set<string> };

export type ApplyResult = {
  doc: ItinDoc;
  /** tempId → 實際 id */
  tempMap: Record<string, string>;
  scope: ApplyScope;
};

export class ChangesetError extends Error {
  constructor(
    message: string,
    public opIndex: number,
  ) {
    super(message);
  }
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 驗證並正規化住宿頭尾交通段(存在 day 上)。 */
function normalizeCarryLeg(leg: CarryLeg | null, i: number): CarryLeg | null {
  if (leg == null) return null;
  if (!LEG_MODES.includes(leg.mode)) {
    throw new ChangesetError(`未知交通方式 ${leg.mode}`, i);
  }
  checkTime(leg.departureTime ?? undefined, "departureTime", i);
  checkTime(leg.arrivalTime ?? undefined, "arrivalTime", i);
  return {
    mode: leg.mode,
    durationMin:
      leg.durationMin != null && Number.isFinite(leg.durationMin)
        ? Math.max(0, Math.floor(leg.durationMin))
        : null,
    departureTime: leg.departureTime ?? null,
    arrivalTime: leg.arrivalTime ?? null,
    transit: leg.transit ?? null,
    notes: leg.notes ?? "",
  };
}

function clampPos(pos: number | undefined, len: number): number {
  if (pos == null || Number.isNaN(pos)) return len;
  return Math.max(0, Math.min(Math.floor(pos), len));
}

function checkTime(v: unknown, field: string, i: number) {
  if (v != null && (typeof v !== "string" || !TIME_RE.test(v))) {
    throw new ChangesetError(`${field} 必須是 HH:MM 格式`, i);
  }
}

/** days/stops 依 position 排序後的全域 stop 順序(跨天,供 leg 相鄰性判定)。 */
export function globalStopOrder(doc: ItinDoc): Stop[] {
  const dayOrder = [...doc.days].sort((a, b) => a.position - b.position);
  const out: Stop[] = [];
  for (const d of dayOrder) {
    out.push(
      ...doc.stops.filter((s) => s.dayId === d.id).sort((a, b) => a.position - b.position),
    );
  }
  return out;
}

function renumber(doc: ItinDoc) {
  const dayOrder = [...doc.days].sort((a, b) => a.position - b.position);
  dayOrder.forEach((d, i) => {
    d.position = i;
  });
  for (const d of doc.days) {
    const stops = doc.stops
      .filter((s) => s.dayId === d.id)
      .sort((a, b) => a.position - b.position);
    stops.forEach((s, i) => {
      s.position = i;
    });
  }
}

export function applyOperations(
  input: ItinDoc,
  ops: Operation[],
  meta: ApplyMeta,
): ApplyResult {
  // 深拷貝,引擎不改動輸入
  const doc: ItinDoc = structuredClone(input);
  const tempMap: Record<string, string> = {};
  const scope: ApplyScope = { dayIds: new Set(), stopIds: new Set() };

  const resolve = (ref: Ref, i: number): string => {
    if (ref.startsWith("$")) {
      const real = tempMap[ref.slice(1)];
      if (!real) throw new ChangesetError(`找不到暫存參照 ${ref}`, i);
      return real;
    }
    return ref;
  };
  const getDay = (ref: Ref, i: number): Day => {
    const id = resolve(ref, i);
    const day = doc.days.find((d) => d.id === id);
    if (!day) throw new ChangesetError(`找不到天 ${id}`, i);
    return day;
  };
  const getStop = (ref: Ref, i: number): Stop => {
    const id = resolve(ref, i);
    const stop = doc.stops.find((s) => s.id === id);
    if (!stop) throw new ChangesetError(`找不到地點 ${id}`, i);
    return stop;
  };

  ops.forEach((raw, i) => {
    const op = raw;
    switch (op.op) {
      case "add_day": {
        const id = meta.newId();
        if (op.tempId) tempMap[op.tempId] = id;
        const pos = clampPos(op.position, doc.days.length);
        for (const d of doc.days) if (d.position >= pos) d.position++;
        doc.days.push({
          id,
          tripId: meta.tripId,
          position: pos,
          title: op.title ?? null,
          note: op.note ?? "",
          lodgingDepartTime: null,
          lodgingReturnTime: null,
          lodgingMorningLeg: null,
          lodgingEveningLeg: null,
        });
        scope.dayIds.add(id);
        break;
      }
      case "update_day": {
        const day = getDay(op.dayId, i);
        if ("title" in op.patch) day.title = op.patch.title ?? null;
        if (op.patch.note != null) day.note = op.patch.note;
        if ("lodgingDepartTime" in op.patch) {
          checkTime(op.patch.lodgingDepartTime ?? undefined, "lodgingDepartTime", i);
          day.lodgingDepartTime = op.patch.lodgingDepartTime ?? null;
        }
        if ("lodgingReturnTime" in op.patch) {
          checkTime(op.patch.lodgingReturnTime ?? undefined, "lodgingReturnTime", i);
          day.lodgingReturnTime = op.patch.lodgingReturnTime ?? null;
        }
        if ("lodgingMorningLeg" in op.patch) {
          day.lodgingMorningLeg = normalizeCarryLeg(op.patch.lodgingMorningLeg ?? null, i);
        }
        if ("lodgingEveningLeg" in op.patch) {
          day.lodgingEveningLeg = normalizeCarryLeg(op.patch.lodgingEveningLeg ?? null, i);
        }
        scope.dayIds.add(day.id);
        break;
      }
      case "move_day": {
        const day = getDay(op.dayId, i);
        const others = doc.days.filter((d) => d.id !== day.id).sort((a, b) => a.position - b.position);
        const pos = clampPos(op.position, others.length);
        others.splice(pos, 0, day);
        others.forEach((d, idx) => {
          d.position = idx;
        });
        scope.dayIds.add(day.id);
        break;
      }
      case "remove_day": {
        const day = getDay(op.dayId, i);
        const stopIds = new Set(doc.stops.filter((s) => s.dayId === day.id).map((s) => s.id));
        doc.days = doc.days.filter((d) => d.id !== day.id);
        doc.stops = doc.stops.filter((s) => s.dayId !== day.id);
        doc.legs = doc.legs.filter(
          (l) => !stopIds.has(l.fromStopId) && !stopIds.has(l.toStopId),
        );
        scope.dayIds.add(day.id);
        break;
      }
      case "add_stop": {
        const day = getDay(op.dayId, i);
        if (!op.name?.trim()) throw new ChangesetError("地點名稱不可為空", i);
        if (op.category && !STOP_CATEGORIES.includes(op.category)) {
          throw new ChangesetError(`未知分類 ${op.category}`, i);
        }
        checkTime(op.startTime, "startTime", i);
        checkTime(op.endTime, "endTime", i);
        if (op.bookingType && !BOOKING_TYPES.includes(op.bookingType)) {
          throw new ChangesetError(`未知預約類型 ${op.bookingType}`, i);
        }
        const id = meta.newId();
        if (op.tempId) tempMap[op.tempId] = id;
        const siblings = doc.stops.filter((s) => s.dayId === day.id);
        const pos = clampPos(op.position, siblings.length);
        for (const s of siblings) if (s.position >= pos) s.position++;
        doc.stops.push({
          id,
          dayId: day.id,
          position: pos,
          name: op.name.trim(),
          category: op.category ?? "other",
          startTime: op.startTime ?? null,
          endTime: op.endTime ?? null,
          placeId: op.placeId ?? null,
          lat: op.lat ?? null,
          lng: op.lng ?? null,
          address: op.address ?? null,
          place: null,
          notes: op.notes ?? "",
          verifyStatus: "unverified",
          verifySources: [],
          verifiedAt: null,
          bookingType: op.bookingType ?? "none",
          bookingStatus: op.bookingStatus ?? "not_booked",
          booking: op.booking ?? null,
          nights: Math.max(1, Math.floor(op.nights ?? 1)),
          updatedAt: meta.now,
          updatedByUserId: meta.actorUserId,
        });
        scope.dayIds.add(day.id);
        scope.stopIds.add(id);
        break;
      }
      case "update_stop": {
        const stop = getStop(op.stopId, i);
        const p = op.patch;
        // 時間變了 → 相鄰交通段標記需重新確認
        if ("startTime" in p || "endTime" in p) {
          for (const l of doc.legs) {
            if (l.fromStopId === stop.id || l.toStopId === stop.id) l.needsReview = true;
          }
        }
        if (p.name != null) {
          if (!p.name.trim()) throw new ChangesetError("地點名稱不可為空", i);
          stop.name = p.name.trim();
        }
        if (p.category != null) {
          if (!STOP_CATEGORIES.includes(p.category)) {
            throw new ChangesetError(`未知分類 ${p.category}`, i);
          }
          stop.category = p.category;
        }
        if ("startTime" in p) {
          checkTime(p.startTime, "startTime", i);
          stop.startTime = p.startTime ?? null;
        }
        if ("endTime" in p) {
          checkTime(p.endTime, "endTime", i);
          stop.endTime = p.endTime ?? null;
        }
        if ("placeId" in p) stop.placeId = p.placeId ?? null;
        if ("lat" in p) stop.lat = p.lat ?? null;
        if ("lng" in p) stop.lng = p.lng ?? null;
        if ("address" in p) stop.address = p.address ?? null;
        if ("place" in p) stop.place = p.place ?? null;
        if (p.notes != null) stop.notes = p.notes;
        if (p.bookingType != null) {
          if (!BOOKING_TYPES.includes(p.bookingType)) {
            throw new ChangesetError(`未知預約類型 ${p.bookingType}`, i);
          }
          stop.bookingType = p.bookingType;
        }
        if (p.bookingStatus != null) {
          if (!BOOKING_STATUSES.includes(p.bookingStatus)) {
            throw new ChangesetError(`未知預約狀態 ${p.bookingStatus}`, i);
          }
          stop.bookingStatus = p.bookingStatus;
        }
        if ("booking" in p) stop.booking = p.booking ?? null;
        if (p.nights != null) stop.nights = Math.max(1, Math.floor(p.nights));
        stop.updatedAt = meta.now;
        stop.updatedByUserId = meta.actorUserId;
        scope.stopIds.add(stop.id);
        scope.dayIds.add(stop.dayId);
        break;
      }
      case "move_stop": {
        const stop = getStop(op.stopId, i);
        const toDay = getDay(op.toDayId, i);
        scope.dayIds.add(stop.dayId);
        // 位置變了 → 相鄰交通段(若重排後仍存活)標記需重新確認
        for (const l of doc.legs) {
          if (l.fromStopId === stop.id || l.toStopId === stop.id) l.needsReview = true;
        }
        // 從原位置抽出
        for (const s of doc.stops) {
          if (s.dayId === stop.dayId && s.position > stop.position) s.position--;
        }
        const targets = doc.stops.filter((s) => s.dayId === toDay.id && s.id !== stop.id);
        const pos = clampPos(op.position, targets.length);
        for (const s of targets) if (s.position >= pos) s.position++;
        stop.dayId = toDay.id;
        stop.position = pos;
        stop.updatedAt = meta.now;
        stop.updatedByUserId = meta.actorUserId;
        scope.dayIds.add(toDay.id);
        scope.stopIds.add(stop.id);
        break;
      }
      case "remove_stop": {
        const stop = getStop(op.stopId, i);
        doc.stops = doc.stops.filter((s) => s.id !== stop.id);
        doc.legs = doc.legs.filter(
          (l) => l.fromStopId !== stop.id && l.toStopId !== stop.id,
        );
        scope.dayIds.add(stop.dayId);
        scope.stopIds.add(stop.id);
        break;
      }
      case "set_leg": {
        const from = getStop(op.fromStopId, i);
        if (!LEG_MODES.includes(op.mode)) {
          throw new ChangesetError(`未知交通方式 ${op.mode}`, i);
        }
        checkTime(op.departureTime, "departureTime", i);
        checkTime(op.arrivalTime, "arrivalTime", i);
        const order = globalStopOrder(doc);
        const idx = order.findIndex((s) => s.id === from.id);
        const next = order[idx + 1];
        if (!next) {
          throw new ChangesetError("最後一個地點之後不能有交通段", i);
        }
        const existing = doc.legs.find((l) => l.fromStopId === from.id);
        const leg: Leg = existing ?? {
          id: meta.newId(),
          tripId: meta.tripId,
          fromStopId: from.id,
          toStopId: next.id,
          mode: op.mode,
          durationMin: null,
          distanceM: null,
          departureTime: null,
          arrivalTime: null,
          transit: null,
          notes: "",
          needsReview: false,
          updatedAt: meta.now,
        };
        leg.toStopId = next.id;
        leg.mode = op.mode;
        if ("durationMin" in op) leg.durationMin = op.durationMin ?? null;
        if ("distanceM" in op) leg.distanceM = op.distanceM ?? null;
        if ("departureTime" in op) leg.departureTime = op.departureTime ?? null;
        if ("arrivalTime" in op) leg.arrivalTime = op.arrivalTime ?? null;
        if ("transit" in op) leg.transit = op.transit ?? null;
        if (op.notes != null) leg.notes = op.notes;
        leg.needsReview = false; // 重新設定 = 已確認
        leg.updatedAt = meta.now;
        if (!existing) doc.legs.push(leg);
        scope.stopIds.add(from.id);
        scope.stopIds.add(next.id);
        break;
      }
      case "remove_leg": {
        const from = getStop(op.fromStopId, i);
        doc.legs = doc.legs.filter((l) => l.fromStopId !== from.id);
        scope.stopIds.add(from.id);
        break;
      }
      case "set_verification": {
        const stop = getStop(op.stopId, i);
        if (!VERIFY_STATUSES.includes(op.status)) {
          throw new ChangesetError(`未知查證狀態 ${op.status}`, i);
        }
        stop.verifyStatus = op.status;
        stop.verifySources = op.sources ?? [];
        stop.verifiedAt = op.status === "verified" ? meta.now : stop.verifiedAt;
        scope.stopIds.add(stop.id);
        break;
      }
      case "update_trip": {
        const p = op.patch;
        if (p.title != null) {
          if (!p.title.trim()) throw new ChangesetError("行程名稱不可為空", i);
          doc.trip.title = p.title.trim();
        }
        if ("destination" in p) doc.trip.destination = p.destination ?? null;
        if ("startDate" in p) {
          if (p.startDate && !DATE_RE.test(p.startDate)) {
            throw new ChangesetError("startDate 必須是 YYYY-MM-DD", i);
          }
          doc.trip.startDate = p.startDate ?? null;
        }
        break;
      }
      default:
        throw new ChangesetError(
          `未知操作 ${(op as { op?: string }).op ?? "?"}`,
          i,
        );
    }
  });

  renumber(doc);

  // leg 相鄰性清理:to_stop 必須仍是 from_stop 的全域下一站(允許跨天,如夜巴)。
  const order = globalStopOrder(doc);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < order.length - 1; i++) nextOf.set(order[i].id, order[i + 1].id);
  doc.legs = doc.legs.filter((l) => nextOf.get(l.fromStopId) === l.toStopId);

  return { doc, tempMap, scope };
}

/** 自動產生變更摘要(使用者直接編輯未附摘要時)。 */
export function describeOps(ops: Operation[], before: ItinDoc): string {
  const parts: string[] = [];
  const nameOf = (ref: Ref) =>
    before.stops.find((s) => s.id === ref)?.name ?? "地點";
  for (const op of ops.slice(0, 3)) {
    switch (op.op) {
      case "add_day":
        parts.push("新增一天");
        break;
      case "remove_day":
        parts.push("移除一天");
        break;
      case "move_day":
        parts.push("調整天數順序");
        break;
      case "update_day":
        parts.push("更新天備註");
        break;
      case "add_stop":
        parts.push(`新增 ${op.name}`);
        break;
      case "update_stop":
        parts.push(`更新 ${nameOf(op.stopId)}`);
        break;
      case "move_stop":
        parts.push(`移動 ${nameOf(op.stopId)}`);
        break;
      case "remove_stop":
        parts.push(`移除 ${nameOf(op.stopId)}`);
        break;
      case "set_leg":
        parts.push(`調整 ${nameOf(op.fromStopId)} 出發交通`);
        break;
      case "remove_leg":
        parts.push(`清除 ${nameOf(op.fromStopId)} 出發交通`);
        break;
      case "set_verification":
        parts.push(`查證 ${nameOf(op.stopId)}`);
        break;
      case "update_trip":
        parts.push("更新行程資訊");
        break;
    }
  }
  let out = parts.join("、");
  if (ops.length > 3) out += ` 等 ${ops.length} 項變更`;
  return out || "行程變更";
}
