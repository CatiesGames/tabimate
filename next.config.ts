import type { NextConfig } from "next";

import { GATEWAY_PORT } from "./src/shared/config";

const nextConfig: NextConfig = {
  // 手機透過區網 IP 連 dev server 時,Next 16 預設會擋跨源 HMR/dev 資源。
  // IP 換了就在這加(只作用於 dev)。
  allowedDevOrigins: ["127.0.0.1", "172.20.10.4", "192.168.0.8"],
  // 所有 /api/* 一律轉給 gateway;Next 本身不寫任何 API route。
  // Set-Cookie 會原樣穿透 rewrite,登入 cookie 由 gateway 設定。
  rewrites: async () => [
    {
      source: "/api/:path*",
      destination: `http://127.0.0.1:${GATEWAY_PORT}/api/:path*`,
    },
  ],
};

export default nextConfig;
