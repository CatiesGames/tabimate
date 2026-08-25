// 行程文件的載入/寫回 + 版本化套用 + 回滾。gateway 是唯一 writer。
import {
  applyOperations,
  describeOps,
  type ItinDoc,
  type Operation,
} from "../shared/changeset";
import type { Day, Leg, Stop, TripMeta, VersionMeta } from "../shared/types";
import { publish } from "./bus";
import { db, newId, now } from "./db";
import { HttpError } from "./http";

type TripRow = {
  id: string;
  title: string;
  destination: string | null;
  start_date: string | null;
  status: "planning" | "active" | "archived";
  itinerary_rev: number;
  agent_session_id: string | null;
  created_at: number;
  updated_at: number;
};

export function getTripRow(tripId: string): TripRow {
  const row = db.query("SELECT * FROM trips WHERE id = ?").get(tripId) as TripRow | null;
  if (!row) throw new HttpError(404, "trip_not_found");
  return row;
}

export function tripMeta(row: TripRow): TripMeta {
  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    startDate: row.start_date,
    status: row.status,
    itineraryRev: row.itinerary_rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDay(r: Record<string, unknown>): Day {
  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    position: r.position as number,
    title: (r.title as string) ?? null,
    note: (r.note as string) ?? "",
    lodgingDepartTime: (r.lodging_depart_time as string) ?? null,
    lodgingReturnTime: (r.lodging_return_time as string) ?? null,
    lodgingMorningLeg: r.lodging_morning_leg ? JSON.parse(r.lodging_morning_leg as string) : null,
    lodgingEveningLeg: r.lodging_evening_leg ? JSON.parse(r.lodging_evening_leg as string) : null,
  };
}

function rowToStop(r: Record<string, unknown>): Stop {
  return {
    id: r.id as string,
    dayId: r.day_id as string,
    position: r.position as number,
    name: r.name as string,
    category: r.category as Stop["category"],
    startTime: (r.start_time as string) ?? null,
    endTime: (r.end_time as string) ?? null,
    placeId: (r.place_id as string) ?? null,
    lat: (r.lat as number) ?? null,
    lng: (r.lng as number) ?? null,
    address: (r.address as string) ?? null,
    place: r.place_json ? JSON.parse(r.place_json as string) : null,
    notes: (r.notes as string) ?? "",
    verifyStatus: r.verify_status as Stop["verifyStatus"],
    verifySources: JSON.parse((r.verify_sources as string) || "[]"),
    verifiedAt: (r.verified_at as number) ?? null,
    bookingType: r.booking_type as Stop["bookingType"],
    bookingStatus: r.booking_status as Stop["bookingStatus"],
    booking: r.booking_json ? JSON.parse(r.booking_json as string) : null,
    nights: (r.nights as number) ?? 1,
    updatedAt: r.updated_at as number,
    updatedByUserId: (r.updated_by_user_id as string) ?? null,
  };
}

function rowToLeg(r: Record<string, unknown>): Leg {
  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    fromStopId: r.from_stop_id as string,
    toStopId: r.to_stop_id as string,
    mode: r.mode as Leg["mode"],
    durationMin: (r.duration_min as number) ?? null,
    distanceM: (r.distance_m as number) ?? null,
    departureTime: (r.departure_time as string) ?? null,
    arrivalTime: (r.arrival_time as string) ?? null,
    transit: r.transit_json ? JSON.parse(r.transit_json as string) : null,
    notes: (r.notes as string) ?? "",
    needsReview: !!r.needs_review,
    updatedAt: r.updated_at as number,
  };
}

export function loadDoc(tripId: string): { row: TripRow; doc: ItinDoc } {
  const row = getTripRow(tripId);
  const days = (
    db.query("SELECT * FROM days WHERE trip_id = ? ORDER BY position").all(tripId) as Array<
      Record<string, unknown>
    >
  ).map(rowToDay);
  const dayIds = days.map((d) => d.id);
  const stops =
    dayIds.length === 0
      ? []
      : (
          db
            .query(
              `SELECT * FROM stops WHERE day_id IN (${dayIds.map(() => "?").join(",")}) ORDER BY position`,
            )
            .all(...dayIds) as Array<Record<string, unknown>>
        ).map(rowToStop);
  const legs = (
    db.query("SELECT * FROM legs WHERE trip_id = ?").all(tripId) as Array<
      Record<string, unknown>
    >
  ).map(rowToLeg);
  return {
    row,
    doc: {
      trip: { title: row.title, destination: row.destination, startDate: row.start_date },
      days,
      stops,
      legs,
    },
  };
}

/** 整批重寫(id 全部保留,回滾與套用共用同一路徑)。必須在交易內呼叫。 */
function persistDoc(tripId: string, doc: ItinDoc, t: number) {
  db.run("DELETE FROM days WHERE trip_id = ?", [tripId]); // stops/legs cascade
  const insDay = db.prepare(
    `INSERT INTO days (id, trip_id, position, title, note, lodging_depart_time, lodging_return_time, lodging_morning_leg, lodging_evening_leg, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const d of doc.days)
    insDay.run(
      d.id,
      tripId,
      d.position,
      d.title,
      d.note,
      d.lodgingDepartTime ?? null,
      d.lodgingReturnTime ?? null,
      d.lodgingMorningLeg ? JSON.stringify(d.lodgingMorningLeg) : null,
      d.lodgingEveningLeg ? JSON.stringify(d.lodgingEveningLeg) : null,
      t,
      t,
    );
  const insStop = db.prepare(
    `INSERT INTO stops (id, day_id, position, name, category, start_time, end_time, place_id, lat, lng, address, place_json, notes, verify_status, verify_sources, verified_at, booking_type, booking_status, booking_json, nights, updated_at, updated_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const s of doc.stops) {
    insStop.run(
      s.id,
      s.dayId,
      s.position,
      s.name,
      s.category,
      s.startTime,
      s.endTime,
      s.placeId,
      s.lat,
      s.lng,
      s.address,
      s.place ? JSON.stringify(s.place) : null,
      s.notes,
      s.verifyStatus,
      JSON.stringify(s.verifySources),
      s.verifiedAt,
      s.bookingType,
      s.bookingStatus,
      s.booking ? JSON.stringify(s.booking) : null,
      s.nights ?? 1,
      s.updatedAt,
      s.updatedByUserId,
    );
  }
  const insLeg = db.prepare(
    `INSERT INTO legs (id, trip_id, from_stop_id, to_stop_id, mode, duration_min, distance_m, departure_time, arrival_time, transit_json, notes, needs_review, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const l of doc.legs) {
    insLeg.run(
      l.id,
      tripId,
      l.fromStopId,
      l.toStopId,
      l.mode,
      l.durationMin,
      l.distanceM,
      l.departureTime,
      l.arrivalTime,
      l.transit ? JSON.stringify(l.transit) : null,
      l.notes,
      l.needsReview ? 1 : 0,
      l.updatedAt,
    );
  }
  db.run(
    "UPDATE trips SET title = ?, destination = ?, start_date = ?, updated_at = ? WHERE id = ?",
    [doc.trip.title, doc.trip.destination, doc.trip.startDate, t, tripId],
  );
}

export type CommitMeta = {
  actorUserId: string | null;
  agentInvolved: boolean;
  changeKind: "user_edit" | "proposal_apply" | "rollback";
  summary?: string;
  proposalId?: string | null;
  restoredFromVersionId?: string | null;
};

export type CommitResult = {
  rev: number;
  versionId: string;
  summary: string;
  scope: { dayIds: string[]; stopIds: string[] };
  tempMap: Record<string, string>;
};

/** 套用 ops(或直接給 doc,回滾用)→ 寫回 + 版本 + 廣播。 */
export function commitChange(
  tripId: string,
  input: { ops: Operation[] } | { doc: ItinDoc },
  meta: CommitMeta,
): CommitResult {
  const t = now();
  let result: CommitResult | undefined;

  db.transaction(() => {
    const { row, doc: before } = loadDoc(tripId);
    let after: ItinDoc;
    let tempMap: Record<string, string> = {};
    let scopeSets = { dayIds: new Set<string>(), stopIds: new Set<string>() };

    if ("ops" in input) {
      const applied = applyOperations(before, input.ops, {
        tripId,
        actorUserId: meta.actorUserId,
        now: t,
        newId,
      });
      after = applied.doc;
      tempMap = applied.tempMap;
      scopeSets = applied.scope;
    } else {
      after = input.doc;
    }

    persistDoc(tripId, after, t);

    const rev = row.itinerary_rev + 1;
    const versionId = newId();
    const summary =
      meta.summary ?? ("ops" in input ? describeOps(input.ops, before) : "還原版本");
    db.run(
      `INSERT INTO versions (id, trip_id, rev, snapshot, summary, change_kind, actor_user_id, agent_involved, proposal_id, restored_from_version_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        versionId,
        tripId,
        rev,
        JSON.stringify(after),
        summary,
        meta.changeKind,
        meta.actorUserId,
        meta.agentInvolved ? 1 : 0,
        meta.proposalId ?? null,
        meta.restoredFromVersionId ?? null,
        t,
      ],
    );
    db.run("UPDATE trips SET itinerary_rev = ? WHERE id = ?", [rev, tripId]);

    result = {
      rev,
      versionId,
      summary,
      scope: { dayIds: [...scopeSets.dayIds], stopIds: [...scopeSets.stopIds] },
      tempMap,
    };
  })();

  const r = result!;
  publish(tripId, {
    type: "itin_changed",
    rev: r.rev,
    versionId: r.versionId,
    changeKind: meta.changeKind,
    actor: {
      userId: meta.actorUserId,
      viaAgent: meta.agentInvolved,
      proposalId: meta.proposalId ?? null,
    },
    summary: r.summary,
    scope: r.scope,
  });
  // 有 placeId 但缺地點詳情的 stop(agent 提案/POI 等來源)→ 背景自動補齊照片/營業時間
  void enrichStopsWithPlaceDetails(tripId);
  return r;
}

/** 背景補齊:對缺 place_json 的 stop 抓 Google 詳情直接寫表(不進版本歷史),完成後通知前端刷新。 */
const enrichLastAttempt = new Map<string, number>();
const ENRICH_RETRY_MS = 10 * 60_000; // 失敗退避:額度滿/網路錯 10 分鐘後允許重試,不永久卡住
export async function enrichStopsWithPlaceDetails(tripId: string) {
  const rows = db
    .query(
      `SELECT s.id, s.place_id, s.lat, s.lng, s.address FROM stops s
       JOIN days d ON d.id = s.day_id
       WHERE d.trip_id = ? AND s.place_id IS NOT NULL AND s.place_json IS NULL`,
    )
    .all(tripId) as Array<{
    id: string;
    place_id: string;
    lat: number | null;
    lng: number | null;
    address: string | null;
  }>;
  const now = Date.now();
  const todo = rows.filter((r) => now - (enrichLastAttempt.get(r.id) ?? 0) > ENRICH_RETRY_MS);
  if (todo.length === 0) return;

  const { placeDetails } = await import("./google");
  const enriched: string[] = [];
  for (const row of todo) {
    enrichLastAttempt.set(row.id, now);
    try {
      const { place } = await placeDetails(row.place_id);
      db.run(
        `UPDATE stops SET place_json = ?,
           lat = COALESCE(lat, ?), lng = COALESCE(lng, ?), address = COALESCE(address, ?)
         WHERE id = ? AND place_json IS NULL`,
        [
          JSON.stringify({
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            openingHours: place.openingHours,
            photoRefs: place.photoRefs,
            website: place.website,
            phone: place.phone,
            googleMapsUri: place.googleMapsUri,
          }),
          place.lat,
          place.lng,
          place.address,
          row.id,
        ],
      );
      enriched.push(row.id);
    } catch {
      // 未設 key / 額度用盡 / 單點失敗:略過
    }
  }
  if (enriched.length > 0) {
    publish(tripId, { type: "itin_meta_changed", stopIds: enriched });
  }
}

export function rollbackToVersion(
  tripId: string,
  versionId: string,
  actorUserId: string | null,
): CommitResult {
  const version = db
    .query("SELECT * FROM versions WHERE id = ? AND trip_id = ?")
    .get(versionId, tripId) as { snapshot: string; rev: number } | null;
  if (!version) throw new HttpError(404, "version_not_found");
  const doc = JSON.parse(version.snapshot) as ItinDoc;
  return commitChange(
    tripId,
    { doc },
    {
      actorUserId,
      agentInvolved: false,
      changeKind: "rollback",
      summary: `還原到版本 ${version.rev}`,
      restoredFromVersionId: versionId,
    },
  );
}

export function listVersions(tripId: string, limit = 100): VersionMeta[] {
  const rows = db
    .query(
      "SELECT id, trip_id, rev, summary, change_kind, actor_user_id, agent_involved, proposal_id, restored_from_version_id, created_at FROM versions WHERE trip_id = ? ORDER BY rev DESC LIMIT ?",
    )
    .all(tripId, limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    tripId: r.trip_id as string,
    rev: r.rev as number,
    summary: r.summary as string,
    changeKind: r.change_kind as VersionMeta["changeKind"],
    actorUserId: (r.actor_user_id as string) ?? null,
    agentInvolved: !!r.agent_involved,
    proposalId: (r.proposal_id as string) ?? null,
    restoredFromVersionId: (r.restored_from_version_id as string) ?? null,
    createdAt: r.created_at as number,
  }));
}

export function getVersionSnapshot(tripId: string, versionId: string): ItinDoc {
  const row = db
    .query("SELECT snapshot FROM versions WHERE id = ? AND trip_id = ?")
    .get(versionId, tripId) as { snapshot: string } | null;
  if (!row) throw new HttpError(404, "version_not_found");
  return JSON.parse(row.snapshot) as ItinDoc;
}
