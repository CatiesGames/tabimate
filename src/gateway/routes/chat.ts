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
  noteUserChoice,
  resetSession,
  stopActive,
} from "../agent/runner";
import { requireTripUser, requireUser } from "../auth";
import { publish } from "../bus";
import { getBlocks, getMessage, listMessages, updateBlock } from "../chat";
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
    const limit = Math.min(Number(ctx.url.searchParams.get("limit") ?? 200) || 200, 500);
    return json({ messages: listMessages(ctx.params.tripId, sinceSeq, limit) });
  });

  route("POST", "/api/trips/:tripId/chat", async (ctx) => {
    const user = requireTripUser(ctx, ctx.params.tripId);
    const body = await readJson<{ text?: string; attachmentIds?: string[] }>(ctx.req);
    const text = body.text?.trim() ?? "";
    if (!text && !(body.attachmentIds?.length)) throw new HttpError(400, "empty_message");
    const message = enqueueChat(
      ctx.params.tripId,
      user.id,
      text || "(請看附圖)",
      body.attachmentIds ?? [],
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
