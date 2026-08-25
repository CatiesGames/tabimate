// 提案:agent 的任何行程變更先落地為 pending 提案,任一成員確認後套用。
import {
  applyOperations,
  ChangesetError,
  type Operation,
} from "../shared/changeset";
import type { Proposal } from "../shared/types";
import { publish } from "./bus";
import { db, newId, now } from "./db";
import { HttpError } from "./http";
import { commitChange, getTripRow, loadDoc } from "./itinerary";

function rowToProposal(r: Record<string, unknown>): Proposal {
  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    status: r.status as Proposal["status"],
    summary: r.summary as string,
    operations: JSON.parse(r.changeset as string),
    baseRev: r.base_rev as number,
    requestedByUserId: (r.requested_by_user_id as string) ?? null,
    chatMessageId: (r.chat_message_id as string) ?? null,
    createdAt: r.created_at as number,
    resolvedAt: (r.resolved_at as number) ?? null,
    resolvedByUserId: (r.resolved_by_user_id as string) ?? null,
    resolutionNote: (r.resolution_note as string) ?? null,
    appliedVersionId: (r.applied_version_id as string) ?? null,
  };
}

export function getProposal(id: string): Proposal {
  const row = db.query("SELECT * FROM proposals WHERE id = ?").get(id) as Record<
    string,
    unknown
  > | null;
  if (!row) throw new HttpError(404, "proposal_not_found");
  return rowToProposal(row);
}

export function listProposals(tripId: string, status?: string): Proposal[] {
  const rows = (
    status
      ? db
          .query(
            "SELECT * FROM proposals WHERE trip_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100",
          )
          .all(tripId, status)
      : db
          .query("SELECT * FROM proposals WHERE trip_id = ? ORDER BY created_at DESC LIMIT 100")
          .all(tripId)
  ) as Array<Record<string, unknown>>;
  return rows.map(rowToProposal);
}

/**
 * 建立提案(MCP propose_changes 呼叫)。
 * 先對當前文件 dry-run,把明顯壞掉的 ops 直接退回給 agent(而不是留給使用者按確認才爆)。
 */
export function createProposal(args: {
  tripId: string;
  summary: string;
  operations: Operation[];
  requestedByUserId: string | null;
  chatMessageId: string | null;
}): { proposal: Proposal } {
  const trip = getTripRow(args.tripId);
  const { doc } = loadDoc(args.tripId);
  try {
    applyOperations(doc, args.operations, {
      tripId: args.tripId,
      actorUserId: args.requestedByUserId,
      now: now(),
      newId: () => newId(),
    });
  } catch (e) {
    if (e instanceof ChangesetError) {
      throw new HttpError(
        422,
        "invalid_changeset",
        `第 ${e.opIndex + 1} 項操作:${e.message}`,
      );
    }
    throw e;
  }

  const id = newId();
  db.run(
    `INSERT INTO proposals (id, trip_id, status, summary, changeset, base_rev, requested_by_user_id, chat_message_id, created_at)
     VALUES (?,?,'pending',?,?,?,?,?,?)`,
    [
      id,
      args.tripId,
      args.summary,
      JSON.stringify(args.operations),
      trip.itinerary_rev,
      args.requestedByUserId,
      args.chatMessageId,
      now(),
    ],
  );
  const proposal = getProposal(id);
  publish(args.tripId, { type: "proposal_new", proposal });
  return { proposal };
}

/**
 * 裁決提案:CAS 恰一人勝;確認時嘗試套用(base_rev 不同仍試,ref 驗證才是真衝突)。
 */
export function resolveProposal(
  proposalId: string,
  verdict: "confirm" | "reject",
  resolvedByUserId: string,
  note?: string,
): Proposal {
  const before = getProposal(proposalId);
  if (before.status !== "pending") {
    // 已被別人裁決:回最新狀態,前端靜默收斂
    throw new HttpError(409, "already_resolved");
  }

  if (verdict === "reject") {
    const res = db.run(
      "UPDATE proposals SET status='rejected', resolved_at=?, resolved_by_user_id=?, resolution_note=? WHERE id=? AND status='pending'",
      [now(), resolvedByUserId, note ?? null, proposalId],
    );
    if (res.changes === 0) throw new HttpError(409, "already_resolved");
    const p = getProposal(proposalId);
    publish(p.tripId, {
      type: "proposal_resolved",
      proposalId,
      status: p.status,
      resolvedByUserId,
    });
    return p;
  }

  // confirm:先 CAS 佔住(過渡狀態仍是 pending → applied/failed_conflict 二選一)
  const claim = db.run(
    "UPDATE proposals SET resolved_at=?, resolved_by_user_id=? WHERE id=? AND status='pending' AND resolved_by_user_id IS NULL",
    [now(), resolvedByUserId, proposalId],
  );
  if (claim.changes === 0) throw new HttpError(409, "already_resolved");

  try {
    const result = commitChange(
      before.tripId,
      { ops: before.operations as Operation[] },
      {
        actorUserId: resolvedByUserId,
        agentInvolved: true,
        changeKind: "proposal_apply",
        summary: before.summary,
        proposalId,
      },
    );
    db.run("UPDATE proposals SET status='applied', applied_version_id=? WHERE id=?", [
      result.versionId,
      proposalId,
    ]);
  } catch (e) {
    if (e instanceof ChangesetError) {
      db.run(
        "UPDATE proposals SET status='failed_conflict', resolution_note=? WHERE id=?",
        [`第 ${e.opIndex + 1} 項操作:${e.message}`, proposalId],
      );
    } else {
      // 非預期錯誤:放回 pending 讓人再試
      db.run("UPDATE proposals SET resolved_at=NULL, resolved_by_user_id=NULL WHERE id=?", [
        proposalId,
      ]);
      throw e;
    }
  }

  const p = getProposal(proposalId);
  publish(p.tripId, {
    type: "proposal_resolved",
    proposalId,
    status: p.status,
    resolvedByUserId,
    versionId: p.appliedVersionId,
    note: p.resolutionNote,
  });
  return p;
}
