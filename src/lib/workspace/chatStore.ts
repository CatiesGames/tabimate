"use client";

// 聊天 store:粗粒度訊息列表 + 細粒度串流訂閱(只有正在串流的訊息逐 token 重渲染)。
import type { ChatBlock, ChatMessage } from "@/shared/types";

type Listener = () => void;

export type AgentPhase =
  | "idle"
  | "queued"
  | "thinking"
  | "tool"
  | "streaming"
  | "stopping";

export class ChatStore {
  private messages = new Map<string, ChatMessage>();
  private order: string[] = [];
  private listListeners = new Set<Listener>();
  private streamListeners = new Set<Listener>();
  private listVersionN = 0;
  private streamVersionN = 0;

  /** 正在串流訊息的未定稿文字。 */
  liveText = "";
  liveMessageId: string | null = null;
  agentPhase: AgentPhase = "idle";
  agentToolLabel = "";
  stoppingBy: string | null = null;

  private pendingDelta = "";
  private flushTimer: number | null = null;

  // ---- 訂閱 ----
  subscribeList = (fn: Listener) => {
    this.listListeners.add(fn);
    return () => this.listListeners.delete(fn);
  };
  subscribeStream = (fn: Listener) => {
    this.streamListeners.add(fn);
    return () => this.streamListeners.delete(fn);
  };
  listVersion = () => this.listVersionN;
  streamVersion = () => this.streamVersionN;

  private emitList() {
    this.listVersionN++;
    for (const fn of this.listListeners) fn();
  }
  private emitStream() {
    this.streamVersionN++;
    for (const fn of this.streamListeners) fn();
  }

  getOrdered(): ChatMessage[] {
    return this.order.map((id) => this.messages.get(id)!).filter(Boolean);
  }

  get(id: string): ChatMessage | undefined {
    return this.messages.get(id);
  }

  // ---- 資料載入 ----
  loadHistory(messages: ChatMessage[]) {
    for (const m of messages) {
      if (!this.messages.has(m.id)) this.order.push(m.id);
      this.messages.set(m.id, m);
    }
    this.order.sort((a, b) => (this.messages.get(a)!.seq - this.messages.get(b)!.seq));
    this.emitList();
  }

  upsert(message: ChatMessage) {
    if (!this.messages.has(message.id)) {
      this.order.push(message.id);
      this.order.sort((a, b) => (this.messages.get(a)?.seq ?? message.seq) - (this.messages.get(b)?.seq ?? message.seq));
    }
    this.messages.set(message.id, message);
    this.emitList();
  }

  // ---- WS 事件 ----
  onStarted(message: ChatMessage) {
    this.upsert(message);
    this.liveMessageId = message.id;
    this.liveText = "";
    this.pendingDelta = "";
    this.emitStream();
  }

  onDelta(messageId: string, text: string) {
    if (this.liveMessageId !== messageId) {
      this.liveMessageId = messageId;
      this.liveText = "";
    }
    this.pendingDelta += text;
    // rAF+50ms 節流 flush,避免逐 token 重渲染
    if (this.flushTimer == null) {
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = null;
        this.liveText += this.pendingDelta;
        this.pendingDelta = "";
        this.emitStream();
      }, 50);
    }
  }

  onBlock(messageId: string, idx: number, block: ChatBlock) {
    const msg = this.messages.get(messageId);
    if (!msg) return;
    const blocks = [...msg.blocks];
    blocks[idx] = block;
    this.messages.set(messageId, { ...msg, blocks });
    // text block 定稿 → 清掉 live 累積(它已成為定稿 block)
    if (block.kind === "text" && messageId === this.liveMessageId) {
      this.liveText = "";
      this.pendingDelta = "";
      if (this.flushTimer != null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.emitStream();
    }
    this.emitList();
  }

  onFinished(messageId: string, status: ChatMessage["status"], error?: string) {
    const msg = this.messages.get(messageId);
    if (msg) {
      this.messages.set(messageId, { ...msg, status, error: error ?? null });
    }
    if (this.liveMessageId === messageId) {
      this.liveMessageId = null;
      this.liveText = "";
      this.pendingDelta = "";
    }
    this.stoppingBy = null;
    this.setPhase("idle");
    this.emitList();
    this.emitStream();
  }

  setPhase(phase: AgentPhase, toolLabel = "") {
    this.agentPhase = phase;
    this.agentToolLabel = toolLabel;
    this.emitStream();
  }

  /** 依 status 重載單一訊息(收斂用)。 */
  refresh(message: ChatMessage) {
    this.upsert(message);
  }
}
