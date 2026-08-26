import { mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import type { Operation } from "../../shared/changeset";
import { ChangesetError } from "../../shared/changeset";
import type { ChatBlock } from "../../shared/types";
import {
  cancelQueued,
  enqueueChat,
  getAgentState,
  noteTransitSelection,
  noteMemoryResolution,
  noteUserChoice,
  resetSession,
  stopActive,
} from "../agent/runner";
import { requireTripUser, requireUser } from "../auth";
import { agentAvatarPath, setAgentIdentity } from "../agent/identity";
import { publish } from "../bus";
import { getBlocks, getMessage, listMessages, listMessagesBefore, updateBlock } from "../chat";
import { db, newId, now } from "../db";
import { HttpError, json, readJson, route } from "../http";
import { commitChange } from "../itinerary";

const ATTACH_ROOT = resolve("./data/attachments");
const MAX_UPLOAD = 12 * 1024 * 1024;
const ALLOWED_MIME = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/heic", ".heic"],
]);

export function registerChatRoutes() {
  route("GET", "/api/trips/:tripId/chat", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    const sinceSeq = Number(ctx.url.searchParams.get("sinceSeq") ?? 0) || 0;
    const before = Number(ctx.url.searchParams.get("before") ?? 0) || 0;
    const limit = Math.min(Number(ctx.url.searchParams.get("limit") ?? 200) || 200, 500);
    if (before > 0) {
      return json({ messages: listMessagesBefore(ctx.params.tripId, before, limit) });
    }
    return json({ messages: listMessages(ctx.params.tripId, sinceSeq, limit) });
  });

  route("POST", "/api/trips/:tripId/chat", async (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const body = await readJson<{
      text?: string;
      attachmentIds?: string[];
      mentions?: Array<{ kind?: string; id?: string; label?: string }>;
    }>(ctx.req);
    const text = body.text?.trim() ?? "";
    if (!text && !(body.attachmentIds?.length)) throw new HttpError(400, "empty_message");
    const mentions = (body.mentions ?? [])
      .filter(
        (m): m is { kind: "day" | "stop" | "leg"; id: string; label: string } =>
          (m.kind === "day" || m.kind === "stop" || m.kind === "leg") &&
          typeof m.id === "string" &&
          typeof m.label === "string",
      )
      .slice(0, 12);
    const message = enqueueChat(
      ctx.params.tripId,
      user.id,
      text || "(請看附圖)",
      body.attachmentIds ?? [],
      mentions,
    );
    return json({ message });
  });

  route("POST", "/api/trips/:tripId/agent/stop", (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const stopped = stopActive(ctx.params.tripId, user.id);
    return json({ stopped });
  });

  route("POST", "/api/chat/messages/:messageId/cancel", (ctx) => {
    const { user } = requireUser(ctx);
    return json({ cancelled: cancelQueued(ctx.params.messageId, user.id) });
  });

  route("POST", "/api/trips/:tripId/agent/reset", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    resetSession(ctx.params.tripId);
    return json({ ok: true });
  });

  route("GET", "/api/trips/:tripId/agent/status", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    return json(getAgentState(ctx.params.tripId));
  });

  // 交通選項卡:任一成員點選 → 直接套用該選項內嵌的 set_leg op(首選勝)。
  route("POST", "/api/trips/:tripId/chat/select-transit", async (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const body = await readJson<{ messageId: string; idx: number; optionIndex: number }>(
      ctx.req,
    );
    const msg = getMessage(body.messageId);
    if (!msg || msg.tripId !== ctx.params.tripId) throw new HttpError(404, "message_not_found");
    const blocks = getBlocks(body.messageId);
    const block = blocks[body.idx];
    if (!block || block.kind !== "transit_options") throw new HttpError(404, "block_not_found");
    if (block.selectedIndex !== null) {
      // 已被別人選走:靜默收斂
      return json({ block, alreadySelected: true });
    }
    const option = block.options[body.optionIndex];
    if (!option) throw new HttpError(400, "bad_option");

    try {
      commitChange(
        ctx.params.tripId,
        { ops: [option.legOp as Operation] },
        {
          actorUserId: user.id,
          agentInvolved: true,
          changeKind: "user_edit",
          summary: `選擇交通:${block.from} → ${block.to} 搭${option.label}`,
        },
      );
    } catch (e) {
      if (e instanceof ChangesetError) {
        throw new HttpError(422, "changeset_error", `套用失敗:${e.message}(行程可能已變動)`);
      }
      throw e;
    }

    const updated: ChatBlock = {
      ...block,
      selectedIndex: body.optionIndex,
      selectedByUserId: user.id,
    };
    updateBlock(body.messageId, body.idx, updated);
    publish(ctx.params.tripId, {
      type: "chat_block",
      messageId: body.messageId,
      idx: body.idx,
      block: updated,
    });
    noteTransitSelection(
      ctx.params.tripId,
      user.id,
      `${block.from} → ${block.to} 搭${option.label}(${option.summary})`,
    );
    return json({ block: updated });
  });

  // 通用選項卡:任一成員點選 → 附 operations 就直接套用,並記錄是誰選的(首選勝)。
  route("POST", "/api/trips/:tripId/chat/select-choice", async (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const body = await readJson<{ messageId: string; idx: number; optionIndex: number }>(
      ctx.req,
    );
    const msg = getMessage(body.messageId);
    if (!msg || msg.tripId !== ctx.params.tripId) throw new HttpError(404, "message_not_found");
    const blocks = getBlocks(body.messageId);
    const block = blocks[body.idx];
    if (!block || block.kind !== "choices") throw new HttpError(404, "block_not_found");
    if (block.selectedIndex !== null) {
      return json({ block, alreadySelected: true });
    }
    const option = block.options[body.optionIndex];
    if (!option) throw new HttpError(400, "bad_option");

    if (option.operations && option.operations.length > 0) {
      try {
        commitChange(
          ctx.params.tripId,
          { ops: option.operations as Operation[] },
          {
            actorUserId: user.id,
            agentInvolved: true,
            changeKind: "user_edit",
            summary: `選擇:${option.label}`,
          },
        );
      } catch (e) {
        if (e instanceof ChangesetError) {
          throw new HttpError(422, "changeset_error", `套用失敗:${e.message}(行程可能已變動)`);
        }
        throw e;
      }
    }

    const updated: ChatBlock = {
      ...block,
      selectedIndex: body.optionIndex,
      selectedByUserId: user.id,
    };
    updateBlock(body.messageId, body.idx, updated);
    publish(ctx.params.tripId, {
      type: "chat_block",
      messageId: body.messageId,
      idx: body.idx,
      block: updated,
    });
    noteUserChoice(ctx.params.tripId, user.id, block.question, option.label, !!option.operations?.length);
    return json({ block: updated });
  });

  // ---- 塔比頭貼 ----

  route("GET", "/api/trips/:tripId/agent/avatar", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    const p2 = agentAvatarPath(ctx.params.tripId);
    if (!p2) throw new HttpError(404, "no_avatar");
    return new Response(Bun.file(p2), {
      headers: { "cache-control": "private, max-age=31536000, immutable" },
    });
  });

  route("POST", "/api/trips/:tripId/agent/identity/reset", async (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    await setAgentIdentity(ctx.params.tripId, { reset: true });
    return json({ ok: true });
  });

  // ---- 塔比記憶:確認卡 resolve + 手動 CRUD ----

  route("POST", "/api/trips/:tripId/chat/resolve-memory", async (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const body = await readJson<{ messageId: string; idx: number; accept: boolean }>(ctx.req);
    const msg = getMessage(body.messageId);
    if (!msg || msg.tripId !== ctx.params.tripId) throw new HttpError(404, "message_not_found");
    const blocks = getBlocks(body.messageId);
    const block = blocks[body.idx];
    if (!block || block.kind !== "memory_proposal") throw new HttpError(404, "block_not_found");
    if (block.status !== "pending") return json({ block, alreadyResolved: true });
    if (body.accept) {
      const action = block.action ?? "add";
      if (action === "add") {
        db.run(
          "INSERT INTO agent_memories (id, trip_id, kind, content, created_by_user_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
          [newId(), ctx.params.tripId, block.memoryKind, block.content, user.id, Date.now(), Date.now()],
        );
      } else if (action === "update" && block.memoryId) {
        db.run(
          "UPDATE agent_memories SET content = ?, updated_at = ? WHERE id = ? AND trip_id = ?",
          [block.content, Date.now(), block.memoryId, ctx.params.tripId],
        );
      } else if (action === "remove" && block.memoryId) {
        db.run("DELETE FROM agent_memories WHERE id = ? AND trip_id = ?", [
          block.memoryId,
          ctx.params.tripId,
        ]);
      }
    }
    const updated = {
      ...block,
      status: body.accept ? ("saved" as const) : ("dismissed" as const),
      resolvedByUserId: user.id,
    };
    updateBlock(body.messageId, body.idx, updated);
    publish(ctx.params.tripId, {
      type: "chat_block",
      messageId: body.messageId,
      idx: body.idx,
      block: updated,
    });
    noteMemoryResolution(
      ctx.params.tripId,
      user.id,
      `${block.action === "remove" ? "忘掉:" : block.action === "update" ? "更新為:" : ""}${block.content}`,
      body.accept,
    );
    return json({ block: updated });
  });

  route("GET", "/api/trips/:tripId/agent/memories", (ctx) => {
    requireTripUser(ctx, ctx.params.tripId);
    const rows = db
      .query(
        "SELECT id, trip_id, kind, content, created_by_user_id, created_at, updated_at FROM agent_memories WHERE trip_id = ? ORDER BY created_at",
      )
      .all(ctx.params.tripId) as Array<Record<string, unknown>>;
    return json({
      memories: rows.map((r) => ({
        id: r.id,
        tripId: r.trip_id,
        kind: r.kind,
        content: r.content,
        createdByUserId: r.created_by_user_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  });

  route("POST", "/api/trips/:tripId/agent/memories", async (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const body = await readJson<{ kind?: string; content?: string }>(ctx.req);
    const kind = body.kind === "persona" ? "persona" : "memory";
    const content = (body.content ?? "").trim().slice(0, 300);
    if (!content) throw new HttpError(400, "empty_content");
    const id = newId();
    db.run(
      "INSERT INTO agent_memories (id, trip_id, kind, content, created_by_user_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [id, ctx.params.tripId, kind, content, user.id, Date.now(), Date.now()],
    );
    return json({ ok: true, id });
  });

  route("PATCH", "/api/agent/memories/:id", async (ctx) => {
    const { user } = requireUser(ctx);
    const row = db.query("SELECT trip_id FROM agent_memories WHERE id = ?").get(ctx.params.id) as
      | { trip_id: string }
      | null;
    if (!row || row.trip_id !== user.trip_id) throw new HttpError(404, "not_found");
    const body = await readJson<{ content?: string }>(ctx.req);
    const content = (body.content ?? "").trim().slice(0, 300);
    if (!content) throw new HttpError(400, "empty_content");
    db.run("UPDATE agent_memories SET content = ?, updated_at = ? WHERE id = ?", [
      content,
      Date.now(),
      ctx.params.id,
    ]);
    return json({ ok: true });
  });

  route("DELETE", "/api/agent/memories/:id", (ctx) => {
    const { user } = requireUser(ctx);
    const row = db.query("SELECT trip_id FROM agent_memories WHERE id = ?").get(ctx.params.id) as
      | { trip_id: string }
      | null;
    if (!row || row.trip_id !== user.trip_id) throw new HttpError(404, "not_found");
    db.run("DELETE FROM agent_memories WHERE id = ?", [ctx.params.id]);
    return json({ ok: true });
  });

  // ---- 附件 ----

  route("POST", "/api/trips/:tripId/attachments", async (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const form = await ctx.req.formData().catch(() => {
      throw new HttpError(400, "bad_form");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "missing_file");
    if (file.size > MAX_UPLOAD) throw new HttpError(413, "file_too_large", "圖片超過 12MB");
    const ext = ALLOWED_MIME.get(file.type) ?? extname(file.name).toLowerCase();
    if (!ALLOWED_MIME.has(file.type)) throw new HttpError(415, "unsupported_type", "僅支援圖片");

    const id = newId();
    const dir = join(ATTACH_ROOT, ctx.params.tripId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}${ext}`);
    await Bun.write(path, file);
    db.run(
      "INSERT INTO attachments (id, trip_id, uploader_user_id, filename, mime, bytes, path, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, ctx.params.tripId, user.id, file.name, file.type, file.size, path, now()],
    );
    return json({ id, url: `/api/attachments/${id}/file` });
  });

  route("GET", "/api/attachments/:id/file", (ctx) => {
    const { user } = requireUser(ctx);
    const row = db.query("SELECT * FROM attachments WHERE id = ?").get(ctx.params.id) as {
      trip_id: string;
      path: string;
      mime: string;
    } | null;
    if (!row || row.trip_id !== user.trip_id) throw new HttpError(404, "not_found");
    return new Response(Bun.file(row.path), {
      headers: { "content-type": row.mime, "cache-control": "private, max-age=31536000" },
    });
  });
}
