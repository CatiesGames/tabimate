// MCP Streamable HTTP 端點(in-process,無 stdio bridge — catclaw 驗證過的做法):
// initialize / tools/list / tools/call;notifications 一律 202。
// 驗證:Authorization: Bearer <per-job token>。
import { z } from "zod";

import { HttpError } from "./http";
import { verifyJobToken, type JobContext } from "./agent/tokens";

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<S>, job: JobContext) => unknown | Promise<unknown>;
};

const tools = new Map<string, ToolDef>();

export function registerTool<S extends z.ZodType>(def: ToolDef<S>) {
  tools.set(def.name, def as unknown as ToolDef);
}

type RpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: RpcRequest["id"], result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: RpcRequest["id"], code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function handleMcp(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const job = verifyJobToken(token);
  if (!job) return Response.json({ error: "unauthorized" }, { status: 401 });

  let rpc: RpcRequest;
  try {
    rpc = (await req.json()) as RpcRequest;
  } catch {
    return rpcError(null, -32700, "parse error");
  }

  // notification(無 id)→ 202,不回 body
  if (rpc.id === undefined && rpc.method?.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  switch (rpc.method) {
    case "initialize":
      return rpcResult(rpc.id, {
        protocolVersion:
          (rpc.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "tabimate", version: "1.0.0" },
      });

    case "ping":
      return rpcResult(rpc.id, {});

    case "tools/list":
      return rpcResult(rpc.id, {
        tools: [...tools.values()].map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: z.toJSONSchema(t.schema),
        })),
      });

    case "tools/call": {
      const name = rpc.params?.name as string;
      const tool = tools.get(name);
      if (!tool) return rpcError(rpc.id, -32602, `unknown tool: ${name}`);
      const parsed = tool.schema.safeParse(rpc.params?.arguments ?? {});
      if (!parsed.success) {
        return rpcResult(rpc.id, {
          content: [
            { type: "text", text: `參數驗證失敗:${parsed.error.message}` },
          ],
          isError: true,
        });
      }
      try {
        const result = await tool.handler(parsed.data, job);
        return rpcResult(rpc.id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
        });
      } catch (e) {
        const msg =
          e instanceof HttpError ? (e.msg ?? e.code) : "工具執行失敗";
        if (!(e instanceof HttpError)) console.error(`[mcp] ${name} failed:`, e);
        return rpcResult(rpc.id, {
          content: [{ type: "text", text: msg }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(rpc.id, -32601, `method not found: ${rpc.method}`);
  }
}
