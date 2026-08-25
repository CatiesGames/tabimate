"use client";

// 單一共用 WS 連線(oathbook useRealtime 模式):typed 事件 + 指數退避重連。
// 重連後的資料補齊由各 store 依 sub_ok 的 rev/seq 比對後走 REST。
import { GATEWAY_PORT } from "@/shared/config";

export type RtStatus = "connecting" | "open" | "closed";

export type RtEvent = { type: string } & Record<string, unknown>;

type Listener = (e: RtEvent) => void;
type StatusListener = (s: RtStatus) => void;

function wsBaseUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:${GATEWAY_PORT}`;
}

export class RtConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private retry = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  status: RtStatus = "closed";

  constructor(private tripId: string) {}

  async connect() {
    this.closedByUser = false;
    this.setStatus("connecting");
    let ticket: string;
    try {
      const res = await fetch("/api/auth/ws-ticket", { cache: "no-store" });
      if (!res.ok) throw new Error("ticket_failed");
      ticket = ((await res.json()) as { ticket: string }).ticket;
    } catch {
      this.scheduleReconnect();
      return;
    }

    const ws = new WebSocket(`${wsBaseUrl()}/ws?token=${encodeURIComponent(ticket)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.setStatus("open");
      ws.send(JSON.stringify({ type: "sub", tripId: this.tripId }));
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
      }, 25_000);
    };
    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(String(ev.data)) as RtEvent;
        if (event.type === "pong") return;
        for (const fn of this.listeners) fn(event);
      } catch {
        // 非 JSON 訊息忽略
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.ws === ws) this.ws = null;
      if (!this.closedByUser) {
        this.setStatus("closed");
        this.scheduleReconnect();
      }
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.retry, 15_000);
    this.retry++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setStatus(s: RtStatus) {
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onEvent(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }
}
