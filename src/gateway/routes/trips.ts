import type { Operation } from "../../shared/changeset";
import { ChangesetError } from "../../shared/changeset";
import { requireTripUser } from "../auth";
import { db } from "../db";
import { HttpError, json, readJson, route } from "../http";
import {
  commitChange,
  enrichStopsWithPlaceDetails,
  getTripRow,
  getVersionSnapshot,
  listVersions,
  loadDoc,
  rollbackToVersion,
  tripMeta,
} from "../itinerary";

export function registerTripRoutes() {
  route("GET", "/api/trips/:tripId/itinerary", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    const { row, doc } = loadDoc(ctx.params.tripId);
    // 讀取時也補缺圖的地點資料(之前只在編輯後補,失敗過的會一直沒照片)
    void enrichStopsWithPlaceDetails(ctx.params.tripId);
    return json({ trip: tripMeta(row), days: doc.days, stops: doc.stops, legs: doc.legs });
  });

  // 使用者直接編輯:立即套用(不經提案),仍寫版本。
  route("POST", "/api/trips/:tripId/edit", async (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const body = await readJson<{ ops?: Operation[]; summary?: string }>(ctx.req);
    if (!Array.isArray(body.ops) || body.ops.length === 0) {
      throw new HttpError(400, "missing_ops");
    }
    try {
      const result = commitChange(
        ctx.params.tripId,
        { ops: body.ops },
        {
          actorUserId: user.id,
          agentInvolved: false,
          changeKind: "user_edit",
          summary: body.summary,
        },
      );
      return json(result);
    } catch (e) {
      if (e instanceof ChangesetError) {
        throw new HttpError(422, "changeset_error", `第 ${e.opIndex + 1} 項操作:${e.message}`);
      }
      throw e;
    }
  });

  route("GET", "/api/trips/:tripId/versions", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    const trip = getTripRow(ctx.params.tripId);
    return json({
      currentRev: trip.itinerary_rev,
      versions: listVersions(ctx.params.tripId),
    });
  });

  route("GET", "/api/trips/:tripId/versions/:versionId", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    return json({ snapshot: getVersionSnapshot(ctx.params.tripId, ctx.params.versionId) });
  });

  route("POST", "/api/trips/:tripId/versions/:versionId/rollback", (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const result = rollbackToVersion(ctx.params.tripId, ctx.params.versionId, user.id);
    return json(result);
  });

  // 行程成員清單(presence/歸屬顯示用)。
  route("GET", "/api/trips/:tripId/members", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    const rows = db
      .query(
        "SELECT id, name, avatar_color FROM users WHERE trip_id = ? AND is_active = 1 ORDER BY created_at",
      )
      .all(ctx.params.tripId) as Array<{ id: string; name: string; avatar_color: string }>;
    return json({
      members: rows.map((r) => ({ id: r.id, name: r.name, color: r.avatar_color })),
    });
  });
}
