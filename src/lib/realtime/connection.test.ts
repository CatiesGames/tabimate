import { describe, expect, test } from "bun:test";

import { wsBaseUrl } from "./connection";

describe("wsBaseUrl", () => {
  test("HTTPS 走同源(反向代理),不帶 4681", () => {
    expect(
      wsBaseUrl({ protocol: "https:", host: "tabimate.home.example.com", hostname: "tabimate.home.example.com" }),
    ).toBe("wss://tabimate.home.example.com");
    // 自訂 443 以外的 https port 也保留在 host 裡
    expect(
      wsBaseUrl({ protocol: "https:", host: "example.com:8443", hostname: "example.com" }),
    ).toBe("wss://example.com:8443");
  });

  test("HTTP 直連 gateway 4681", () => {
    expect(wsBaseUrl({ protocol: "http:", host: "192.168.0.8:4680", hostname: "192.168.0.8" })).toBe(
      "ws://192.168.0.8:4681",
    );
  });
});
