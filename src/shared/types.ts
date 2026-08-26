// 兩側共用的資料模型型別(gateway 是權威,前端照此消費)。
import type {
  BookingStatus,
  BookingType,
  LegMode,
  StopCategory,
  VerifyStatus,
} from "./config";

export type PublicUser = {
  id: string;
  tripId: string;
  name: string;
  color: string;
};

export type TripMeta = {
  id: string;
  title: string;
  destination: string | null;
  startDate: string | null; // YYYY-MM-DD
  status: "planning" | "active" | "archived";
  itineraryRev: number;
  createdAt: number;
  updatedAt: number;
};

export type TripListItem = TripMeta & { userCount: number };

export type BookingInfo = {
  platform?: string;
  url?: string;
  confirmationCode?: string;
  price?: string;
  /** 開賣日(還不能訂,到這天才開放)。YYYY-MM-DD */
  onSaleDate?: string;
  /** 預約/購票截止日。YYYY-MM-DD */
  deadline?: string;
  bookedByUserId?: string;
  note?: string;
};

export type VerifySource = { url: string; title: string; checkedAt: number };

export type PlaceInfo = {
  rating?: number;
  userRatingCount?: number;
  openingHours?: string[]; // 每週各天文字描述
  openNow?: boolean;
  photoRefs?: string[];
  website?: string;
  phone?: string;
  googleMapsUri?: string;
};

export type Stop = {
  id: string;
  dayId: string;
  position: number;
  name: string;
  category: StopCategory;
  startTime: string | null; // HH:MM
  endTime: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  place: PlaceInfo | null;
  notes: string;
  verifyStatus: VerifyStatus;
  verifySources: VerifySource[];
  verifiedAt: number | null;
  bookingType: BookingType;
  bookingStatus: BookingStatus;
  booking: BookingInfo | null;
  /** 住宿住幾晚(連泊;入住日=所在天,退房日=入住日+nights)。非住宿恆為 1。 */
  nights: number;
  updatedAt: number;
  updatedByUserId: string | null;
};

export type TransitDetail = {
  summary: string; // 「JR山手線 → 東京Metro銀座線」
  steps?: Array<{
    mode: string;
    line?: string;
    headsign?: string;
    departureStop?: string;
    arrivalStop?: string;
    departureTime?: string;
    arrivalTime?: string;
    numStops?: number;
  }>;
  fare?: string;
  polyline?: string; // encoded
};

export type Leg = {
  id: string;
  tripId: string;
  fromStopId: string;
  toStopId: string;
  mode: LegMode;
  durationMin: number | null;
  distanceM: number | null;
  departureTime: string | null;
  arrivalTime: string | null;
  transit: TransitDetail | null;
  notes: string;
  /** 相鄰地點被移動/改時間後自動標記,提醒重新確認交通;set_leg 會清掉。 */
  needsReview: boolean;
  /** 交通購票(新幹線/機場快線/指定席…):與 stop 預約同一套語意。 */
  bookingType: BookingType;
  bookingStatus: BookingStatus;
  booking: BookingInfo | null;
  updatedAt: number;
};

/** 續住日「住宿↔當天頭/尾行程」的交通段(存在 day 上,無獨立 id)。 */
export type CarryLeg = {
  mode: LegMode;
  durationMin: number | null;
  departureTime: string | null;
  arrivalTime: string | null;
  transit: TransitDetail | null;
  notes: string;
};

export type Day = {
  id: string;
  tripId: string;
  position: number;
  title: string | null;
  note: string;
  /** 續住日:早上幾點離開住宿(退房日以住宿的退房時間為準,此欄不用)。 */
  lodgingDepartTime: string | null;
  /** 續住中間天:晚上幾點回到住宿。 */
  lodgingReturnTime: string | null;
  /** 住宿 → 當天第一個行程的交通。 */
  lodgingMorningLeg: CarryLeg | null;
  /** 當天最後一個行程 → 住宿的交通。 */
  lodgingEveningLeg: CarryLeg | null;
};

export type Itinerary = {
  trip: TripMeta;
  days: Day[];
  stops: Stop[];
  legs: Leg[];
};

export type Proposal = {
  id: string;
  tripId: string;
  status: "pending" | "applied" | "rejected" | "failed_conflict" | "superseded";
  summary: string;
  operations: unknown[]; // Operation[](見 changeset.ts)
  baseRev: number;
  requestedByUserId: string | null;
  chatMessageId: string | null;
  createdAt: number;
  resolvedAt: number | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  appliedVersionId: string | null;
};

export type VersionMeta = {
  id: string;
  tripId: string;
  rev: number;
  summary: string;
  changeKind: "user_edit" | "proposal_apply" | "rollback";
  actorUserId: string | null;
  agentInvolved: boolean;
  proposalId: string | null;
  restoredFromVersionId: string | null;
  createdAt: number;
};

export type ChatMessageStatus =
  | "queued"
  | "streaming"
  | "complete"
  | "stopped"
  | "error";

export type ChatBlock =
  | { kind: "text"; text: string }
  | {
      kind: "tool_status";
      toolCallId: string;
      tool: string;
      label: string;
      state: "running" | "done" | "failed";
      detail?: string;
    }
  | {
      kind: "transit_options";
      blockId: string;
      from: string;
      to: string;
      options: TransitOptionCard[];
      selectedIndex: number | null;
      selectedByUserId: string | null;
    }
  | {
      kind: "proposal";
      proposalId: string;
    }
  | {
      kind: "verification";
      stopId: string | null;
      place: string;
      verdict: "confirmed" | "mismatch" | "unknown";
      hours?: string[];
      note?: string;
      sources: Array<{ url: string; title: string }>;
    }
  | {
      kind: "booking_audit";
      items: BookingAuditItem[];
    }
  | {
      kind: "choices";
      blockId: string;
      question: string;
      options: Array<{
        label: string;
        description?: string;
        /** 附了 operations 的選項,成員點選後直接套用(不再提案)。 */
        operations?: unknown[];
      }>;
      selectedIndex: number | null;
      selectedByUserId: string | null;
    }
  | { kind: "image"; attachmentId: string; url: string }
  | { kind: "error"; message: string };

export type TransitOptionCard = {
  mode: LegMode;
  label: string; // 「電車」「巴士」…
  durationMin: number;
  fare?: string;
  transfers?: number;
  summary: string;
  departureTime?: string;
  arrivalTime?: string;
  recommended?: boolean;
  /** 現成的 set_leg op payload,使用者點選後 gateway 直接套用。 */
  legOp: unknown;
};

export type BookingAuditItem = {
  stopId: string | null;
  name: string;
  dayLabel?: string;
  bookingType: BookingType;
  bookingStatus: BookingStatus;
  requirement: string; // 「需在官網預約,每月10日開賣下月票」
  deadline?: string;
  url?: string;
  sources?: Array<{ url: string; title: string }>;
};

/** 聊天 @ 提及:把行程中的天/地點/交通指名給塔比。 */
export type ChatMention = {
  kind: "day" | "stop" | "leg";
  /** day id / stop id / leg 的 fromStopId */
  id: string;
  /** 輸入框顯示的文字(不含 @) */
  label: string;
};

export type ChatMessage = {
  id: string;
  tripId: string;
  seq: number;
  role: "user" | "assistant" | "system";
  userId: string | null;
  content: string;
  status: ChatMessageStatus;
  error: string | null;
  model: string | null;
  blocks: ChatBlock[];
  attachmentIds: string[];
  mentions: ChatMention[];
  /** 塔比回覆時所回應的那則訊息(引用氣泡+跳轉)。 */
  replyToMessageId: string | null;
  createdAt: number;
  completedAt: number | null;
};

export type PresenceEntry = {
  userId: string;
  name: string;
  color: string;
  online: boolean;
  viewing: { dayId?: string; stopId?: string } | null;
};
