// 極簡 HTTP router:pattern 以 / 切段,:param 擷取。所有回應 JSON。
export type Ctx = {
  req: Request;
  url: URL;
  params: Record<string, string>;
  /** handler 可設定,dispatch 會附加到回應(session 滑動刷新用)。 */
  setCookies: string[];
};

export type Handler = (ctx: Ctx) => Response | Promise<Response>;

type Route = { method: string; segments: string[]; handler: Handler };

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, init);
}

export function err(status: number, code: string, message?: string): Response {
  return Response.json({ error: code, message }, { status });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public msg?: string,
  ) {
    super(code);
  }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function dispatch(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  outer: for (const r of routes) {
    if (r.method !== req.method) continue;
    if (r.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < parts.length; i++) {
      const seg = r.segments[i];
      if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(parts[i]);
      else if (seg !== parts[i]) continue outer;
    }

    // CSRF:mutating 請求必須是 JSON 或 multipart(SameSite=Lax 之外的第二道)。
    if (MUTATING.has(req.method)) {
      const ct = req.headers.get("content-type") ?? "";
      if (
        !ct.includes("application/json") &&
        !ct.includes("multipart/form-data") &&
        req.headers.get("content-length") !== null &&
        req.headers.get("content-length") !== "0"
      ) {
        return err(415, "unsupported_content_type");
      }
    }

    const ctx: Ctx = { req, url, params, setCookies: [] };
    try {
      const res = await r.handler(ctx);
      if (ctx.setCookies.length === 0) return res;
      const headers = new Headers(res.headers);
      for (const c of ctx.setCookies) headers.append("Set-Cookie", c);
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      if (e instanceof HttpError) return err(e.status, e.code, e.msg);
      console.error(`[gateway] ${req.method} ${url.pathname} failed:`, e);
      return err(500, "internal_error");
    }
  }
  return null;
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie");
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(/;\s*/)) {
    const idx = pair.indexOf("=");
    if (idx > 0) out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
  }
  return out;
}

export function buildCookie(name: string, value: string, maxAgeMs: number): string {
  // 無 Secure:平文 HTTP LAN 的刻意取捨(README 記載)。
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}
