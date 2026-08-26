// 塔比變身:名稱 + 頭貼(塔比自己上網找圖網址,伺服器端下載存檔)。
// 每個行程一張頭貼檔,替換/重設時舊檔一律刪除,不遺留。
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

import { publish } from "../bus";
import { db, now } from "../db";

const AVATAR_DIR = resolve("./data/agent-avatars");

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type AgentIdentity = {
  name: string | null;
  avatarVersion: number | null;
  /** 角色語氣/人設(變身的一部分,變回預設時一起清除;與基礎個性 persona 記憶互不影響)。 */
  rolePersona: string | null;
};

export function getAgentIdentity(tripId: string): AgentIdentity {
  const row = db
    .query(
      "SELECT agent_name, agent_avatar_ext, agent_identity_at, agent_role_persona FROM trips WHERE id = ?",
    )
    .get(tripId) as {
    agent_name: string | null;
    agent_avatar_ext: string | null;
    agent_identity_at: number | null;
    agent_role_persona: string | null;
  } | null;
  return {
    name: row?.agent_name ?? null,
    avatarVersion: row?.agent_avatar_ext ? (row.agent_identity_at ?? 1) : null,
    rolePersona: row?.agent_role_persona ?? null,
  };
}

export function agentAvatarPath(tripId: string): string | null {
  const row = db
    .query("SELECT agent_avatar_ext FROM trips WHERE id = ?")
    .get(tripId) as { agent_avatar_ext: string | null } | null;
  if (!row?.agent_avatar_ext) return null;
  const p = join(AVATAR_DIR, `${tripId}.${row.agent_avatar_ext}`);
  return existsSync(p) ? p : null;
}

/** 刪掉這個行程的所有頭貼檔(換圖/重設時呼叫,不遺留舊檔)。 */
function removeAvatarFiles(tripId: string) {
  if (!existsSync(AVATAR_DIR)) return;
  for (const f of readdirSync(AVATAR_DIR)) {
    if (f.startsWith(`${tripId}.`)) unlinkSync(join(AVATAR_DIR, f));
  }
}

export async function setAgentIdentity(
  tripId: string,
  args: { name?: string; avatarImageUrl?: string; rolePersona?: string; reset?: boolean },
): Promise<{ ok: true; identity: AgentIdentity } | { error: string }> {
  const t = now();
  if (args.reset) {
    removeAvatarFiles(tripId);
    db.run(
      "UPDATE trips SET agent_name = NULL, agent_avatar_ext = NULL, agent_role_persona = NULL, agent_identity_at = ? WHERE id = ?",
      [t, tripId],
    );
  } else {
    if (args.avatarImageUrl) {
      let res: Response;
      try {
        res = await fetch(args.avatarImageUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (tabimate avatar fetch)" },
          signal: AbortSignal.timeout(12_000),
          redirect: "follow",
        });
      } catch {
        return { error: "圖片下載失敗(連不上或逾時),換一個圖片網址再試" };
      }
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      const ext = EXT_BY_TYPE[type];
      if (!res.ok || !ext) {
        return { error: `這個網址不是可用的圖片(content-type: ${type || "未知"}),要用直接指向 .jpg/.png 等圖檔的連結` };
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 3 * 1024 * 1024) return { error: "圖片超過 3MB,找一張小一點的" };
      if (buf.byteLength < 512) return { error: "圖片內容異常(太小),換一個網址" };
      mkdirSync(AVATAR_DIR, { recursive: true });
      removeAvatarFiles(tripId);
      await Bun.write(join(AVATAR_DIR, `${tripId}.${ext}`), buf);
      db.run("UPDATE trips SET agent_avatar_ext = ?, agent_identity_at = ? WHERE id = ?", [
        ext,
        t,
        tripId,
      ]);
    }
    if (args.rolePersona !== undefined) {
      db.run("UPDATE trips SET agent_role_persona = ?, agent_identity_at = ? WHERE id = ?", [
        args.rolePersona.trim().slice(0, 500) || null,
        t,
        tripId,
      ]);
    }
    if (args.name !== undefined) {
      const name = args.name.trim().slice(0, 20);
      if (!name) return { error: "名稱不可為空" };
      db.run("UPDATE trips SET agent_name = ?, agent_identity_at = ? WHERE id = ?", [
        name,
        t,
        tripId,
      ]);
    }
  }
  const identity = getAgentIdentity(tripId);
  publish(tripId, { type: "agent_identity", identity });
  return { ok: true, identity };
}
