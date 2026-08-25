// tabimate gateway — 唯一後端:REST /api/* + WS /ws + MCP /mcp + agent runner。
// 單一程序、單一 SQLite writer(catclaw 教訓:gateway 是磁碟與記憶體狀態的唯一擁有者)。
import { GATEWAY_PORT } from "../shared/config";
import { registerCoreTools } from "./agent/tools";
import { mintJobToken } from "./agent/tokens";
import { dispatch, err, json } from "./http";
import { handleMcp } from "./mcp";
import { initRunner } from "./agent/runner";
import { registerAdminRoutes, setSettingsChangedHook } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerChatRoutes } from "./routes/chat";
import { registerGoogleRoutes } from "./routes/google";
import { registerProposalRoutes } from "./routes/proposals";
import { registerTripRoutes } from "./routes/trips";
import { getSetting, seedSettings } from "./settings";
import { publish } from "./bus";
import { initWsBridge, setServer, tryUpgradeWs, wsHandlers, type WsData } from "./ws";

seedSettings();
registerAuthRoutes();
registerAdminRoutes();
registerTripRoutes();
registerProposalRoutes();
registerChatRoutes();
registerGoogleRoutes();
registerCoreTools();

// dev 專用:手鑄 MCP job token(冒煙測試直打 /mcp 用)。
if (process.env.NODE_ENV !== "production") {
  const { route, readJson } = await import("./http");
  route("POST", "/api/dev/mint-job-token", async (ctx) => {
    const body = await readJson<{ tripId: string; userId?: string }>(ctx.req);
    return json({
      token: mintJobToken({
        tripId: body.tripId,
        chatMessageId: null,
        requestedByUserId: body.userId ?? null,
      }),
    });
  });
}

// 後台改設定 → 全端即時生效(地圖 key 熱插拔、agent model 切換)。
setSettingsChangedHook(() => {
  publish("*", {
    type: "config_changed",
    googleReady: getSetting("google_maps_api_key") !== "",
    mapsBrowserKey: getSetting("google_maps_browser_key") || null,
    agentModel: getSetting("agent_model"),
  });
});

const server = Bun.serve<WsData>({
  hostname: "0.0.0.0",
  port: GATEWAY_PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      // 成功 upgrade 時回 undefined 是 Bun 的約定,型別上以 cast 表達
      return tryUpgradeWs(req, srv) as unknown as Response;
    }
    if (url.pathname === "/mcp" && req.method === "POST") {
      return handleMcp(req);
    }
    if (url.pathname === "/healthz" || url.pathname === "/api/healthz") {
      return json({ ok: true, service: "tabimate-gateway" });
    }
    const res = await dispatch(req);
    if (res) return res;
    return err(404, "not_found");
  },
  websocket: wsHandlers,
});

setServer(server);
initWsBridge();
initRunner();

console.log(`[gateway] listening on http://0.0.0.0:${server.port}`);
