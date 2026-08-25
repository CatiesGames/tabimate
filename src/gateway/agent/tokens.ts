// per-job MCP Bearer token:內嵌 {tripId, chatMessageId, requestedByUserId},
// 讓 MCP 工具零參數取得歸屬與範圍。純記憶體,job 結束即撤銷。
import { newId } from "../db";

export type JobContext = {
  tripId: string;
  chatMessageId: string | null;
  requestedByUserId: string | null;
};

const tokens = new Map<string, JobContext>();

export function mintJobToken(ctx: JobContext): string {
  const token = `job_${newId(28)}`;
  tokens.set(token, ctx);
  return token;
}

export function verifyJobToken(token: string): JobContext | null {
  return tokens.get(token) ?? null;
}

export function revokeJobToken(token: string) {
  tokens.delete(token);
}
