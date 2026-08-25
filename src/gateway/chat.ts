// 聊天訊息與 block 的持久層。block 級持久化;token delta 只走 WS。
import type { ChatBlock, ChatMessage, ChatMessageStatus } from "../shared/types";
import { db, newId, now } from "./db";

function rowToMessage(r: Record<string, unknown>, blocks: ChatBlock[]): ChatMessage {
  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    seq: r.seq as number,
    role: r.role as ChatMessage["role"],
    userId: (r.user_id as string) ?? null,
    content: (r.content as string) ?? "",
    status: r.status as ChatMessageStatus,
    error: (r.error as string) ?? null,
    model: (r.model as string) ?? null,
    blocks,
    attachmentIds: JSON.parse((r.attachment_ids as string) || "[]"),
    replyToMessageId: (r.reply_to_message_id as string) ?? null,
    createdAt: r.created_at as number,
    completedAt: (r.completed_at as number) ?? null,
  };
}

export function insertMessage(args: {
  tripId: string;
  role: ChatMessage["role"];
  userId?: string | null;
  content?: string;
  status?: ChatMessageStatus;
  model?: string | null;
  attachmentIds?: string[];
  replyToMessageId?: string | null;
}): ChatMessage {
  const id = newId();
  const t = now();
  db.transaction(() => {
    const seq =
      (
        db
          .query("SELECT COALESCE(MAX(seq), 0) AS s FROM chat_messages WHERE trip_id = ?")
          .get(args.tripId) as { s: number }
      ).s + 1;
    db.run(
      `INSERT INTO chat_messages (id, trip_id, seq, role, user_id, content, status, model, attachment_ids, reply_to_message_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        args.tripId,
        seq,
        args.role,
        args.userId ?? null,
        args.content ?? "",
        args.status ?? "complete",
        args.model ?? null,
        JSON.stringify(args.attachmentIds ?? []),
        args.replyToMessageId ?? null,
        t,
      ],
    );
  })();
  return getMessage(id)!;
}

export function getMessage(id: string): ChatMessage | null {
  const row = db.query("SELECT * FROM chat_messages WHERE id = ?").get(id) as Record<
    string,
    unknown
  > | null;
  if (!row) return null;
  return rowToMessage(row, getBlocks(id));
}

export function getBlocks(messageId: string): ChatBlock[] {
  const rows = db
    .query("SELECT payload FROM chat_blocks WHERE message_id = ? ORDER BY idx")
    .all(messageId) as Array<{ payload: string }>;
  return rows.map((r) => JSON.parse(r.payload) as ChatBlock);
}

export function insertBlock(messageId: string, idx: number, block: ChatBlock) {
  db.run(
    "INSERT INTO chat_blocks (message_id, idx, kind, payload, created_at) VALUES (?,?,?,?,?)",
    [messageId, idx, block.kind, JSON.stringify(block), now()],
  );
}

export function updateBlock(messageId: string, idx: number, block: ChatBlock) {
  db.run("UPDATE chat_blocks SET payload = ? WHERE message_id = ? AND idx = ?", [
    JSON.stringify(block),
    messageId,
    idx,
  ]);
}

export function finalizeMessage(
  id: string,
  status: ChatMessageStatus,
  patch: { content?: string; error?: string; sessionId?: string; model?: string } = {},
) {
  db.run(
    `UPDATE chat_messages SET status = ?, content = COALESCE(?, content), error = ?,
     session_id = COALESCE(?, session_id), model = COALESCE(?, model), completed_at = ? WHERE id = ?`,
    [
      status,
      patch.content ?? null,
      patch.error ?? null,
      patch.sessionId ?? null,
      patch.model ?? null,
      now(),
      id,
    ],
  );
}

export function listMessages(tripId: string, sinceSeq = 0, limit = 200): ChatMessage[] {
  const rows = db
    .query(
      "SELECT * FROM chat_messages WHERE trip_id = ? AND seq > ? ORDER BY seq LIMIT ?",
    )
    .all(tripId, sinceSeq, limit) as Array<Record<string, unknown>>;
  return rows.map((r) => rowToMessage(r, getBlocks(r.id as string)));
}

/** gateway 重啟收尾:running 標記為 error,queued 保留(runner 會重新撿起)。 */
export function recoverJobsOnBoot() {
  const running = db
    .query("SELECT chat_message_id FROM agent_jobs WHERE status = 'running'")
    .all() as Array<{ chat_message_id: string }>;
  for (const j of running) {
    db.run(
      "UPDATE chat_messages SET status='error', error='gateway 重啟中斷' WHERE id = ? AND status IN ('queued','streaming')",
      [j.chat_message_id],
    );
  }
  db.run(
    "UPDATE agent_jobs SET status='error', finished_at=? WHERE status='running'",
    [now()],
  );
}
