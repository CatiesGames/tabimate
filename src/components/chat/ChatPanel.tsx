"use client";

// 共用 agent 聊天面板:多人同看串流、狀態視覺化、優雅中止、圖片上傳、佇列。
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CompassRose, ArrowCounterClockwise,
  CaretDoubleDown,
  ImageSquare,
  PaperPlaneRight,
  Robot,
  Stop as StopIcon,
  X } from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { chatDateLabel, clockLabel } from "@/lib/dates";
import type { ChatMention, ChatMessage } from "@/shared/types";
import { useChat, useSelection, useSession, useTrip } from "@/lib/workspace/WorkspaceProvider";
import { TabiSoulDialog } from "./TabiSoul";
import { Avatar, ConfirmDialog, Hint, PulseDots, Spinner, Tag, ZoomableImage } from "@/components/ui";
import { BlockRenderer, maskUnfinishedImage, MiniMarkdown, ToolStatusBlock } from "./blocks";
import {
  buildCandidates,
  filterCandidates,
  findMentionTrigger,
  MentionPicker,
  MentionText,
  resolveMentions,
  type MentionCandidate,
} from "./mentions";
import type { ChatBlock } from "@/shared/types";
import { ArrowClockwise, CaretDown, ImagesSquare, Wrench, XCircle } from "@phosphor-icons/react";

export function ChatPanel() {
  const { store, agent } = useChat();
  const { me, tripId, memberOf } = useSession();
  const uploadRef = useRef<{ upload: (f: File) => void } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useSyncExternalStore(store.subscribeList, store.listVersion, store.listVersion);
  const messages = store.getOrdered();

  return (
    <div
      className="relative flex h-full flex-col bg-surface"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        for (const f of e.dataTransfer.files) {
          if (f.type.startsWith("image/")) uploadRef.current?.upload(f);
        }
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ocean bg-ocean-wash/85">
          <ImagesSquare weight="duotone" className="size-10 text-ocean" />
          <p className="text-sm font-medium text-ocean-deep">放開加入圖片,可搭配文字一起傳給塔比</p>
        </div>
      )}
      <ChatHeader />
      <MessageList messages={messages} />
      <Composer
        uploadRef={uploadRef}
        disabled={!agent.available}
        onSend={async (text, attachmentIds, mentions) => {
          await apiFetch(`/api/trips/${tripId}/chat`, { json: { text, attachmentIds, mentions } });
        }}
      />
      {!agent.available && (
        <p className="border-t border-line bg-sun-wash px-3 py-1.5 text-center text-[11px] text-sun-deep">
          claude CLI 未安裝或不可用,塔比暫時休息中
        </p>
      )}
      {agent.queue.length > 0 && (
        <p className="border-t border-line px-3 py-1 text-center text-[11px] text-ink-faint">
          排隊中:
          {agent.queue.map((q) => memberOf(q.userId).name).join("、")}
          {agent.queue.some((q) => q.userId === me.id) &&
            ` · 你的訊息在第 ${agent.queue.find((q) => q.userId === me.id)!.position} 位`}
        </p>
      )}
    </div>
  );
}

function ChatHeader() {
  const { store } = useChat();
  const { tripId, memberOf } = useSession();
  const [confirmReset, setConfirmReset] = useState(false);
  const [soulOpen, setSoulOpen] = useState(false);
  const agentName = useAgentName();
  useSyncExternalStore(store.subscribeStream, store.streamVersion, store.streamVersion);
  const phase = store.agentPhase;

  return (
    <header className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
      <button
        aria-label="塔比的靈魂與記憶"
        onClick={() => setSoulOpen(true)}
        title="查看塔比的靈魂與記憶"
        className="tm-focus relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
      >
        <AgentFace className="flex size-9 items-center justify-center rounded-full" iconClassName="size-5" />
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface",
            phase === "idle" ? "bg-leaf" : "bg-sun animate-pulse",
          )}
        />
      </button>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-ink">{agentName} <span className="text-[11px] font-normal text-ink-faint">AI 旅遊嚮導</span></p>
        <p className="flex items-center gap-1.5 text-[11px] text-ink-soft">
          {phase === "idle" && "隨時待命 — 行程、查證、交通、推薦都找我"}
          {phase === "queued" && "已收到,排隊處理中…"}
          {phase === "thinking" && (
            <>
              思考中
              <PulseDots />
            </>
          )}
          {phase === "tool" && (
            <>
              <Spinner className="size-3" />
              <span className="truncate">{store.agentToolLabel || "查資料中…"}</span>
            </>
          )}
          {phase === "streaming" && (
            <>
              回覆中
              <PulseDots />
            </>
          )}
          {phase === "stopping" && (
            <span className="text-sun-deep">
              停止中…{store.stoppingBy && `(${memberOf(store.stoppingBy).name})`}
            </span>
          )}
        </p>
      </div>
      <Hint tip={"重置對話脈絡\n塔比會忘記先前聊過的內容\n(行程資料不受影響)"}>
        <button
          aria-label="重置對話脈絡"
          onClick={() => setConfirmReset(true)}
          className="tm-focus rounded-md p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        >
          <ArrowCounterClockwise className="size-4" />
        </button>
      </Hint>
      <TabiSoulDialog open={soulOpen} onClose={() => setSoulOpen(false)} />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="重置塔比的對話脈絡?"
        description="塔比會忘記先前聊過的內容(偏好、討論到一半的事),下一則訊息從新對話開始。行程、預約、版本歷史都不受影響。"
        confirmLabel="重置"
        onConfirm={() => {
          setConfirmReset(false);
          apiFetch(`/api/trips/${tripId}/agent/reset`, { json: {} });
        }}
      />
    </header>
  );
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [stickBottom, setStickBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [floatingDate, setFloatingDate] = useState<string | null>(null);
  const floatingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { store, loadOlder } = useChat();
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);

  // 上滑到頂 → 載入更舊的對話(保持目前閱讀位置)
  const maybeLoadOlder = () => {
    const el = listRef.current;
    if (!el || !hasMore || loadingOlderRef.current) return;
    if (el.scrollTop > 80) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const prevH = el.scrollHeight;
    const prevTop = el.scrollTop;
    loadOlder()
      .then((n) => {
        if (n < 60) setHasMore(false);
        requestAnimationFrame(() => {
          const el2 = listRef.current;
          if (el2 && n > 0) el2.scrollTop = el2.scrollHeight - prevH + prevTop;
          loadingOlderRef.current = false;
          setLoadingOlder(false);
        });
      })
      .catch(() => {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      });
  };
  useSyncExternalStore(store.subscribeStream, store.streamVersion, store.streamVersion);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // 貼底時新內容自動捲;上滑閱讀時不打擾
  useEffect(() => {
    if (stickBottom) {
      scrollToBottom();
      setUnseen(0);
    } else {
      setUnseen((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, store.streamVersion(), store.liveText.length]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    maybeLoadOlder();
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setStickBottom(nearBottom);
    if (nearBottom) setUnseen(0);
    // 浮動日期:找視窗頂端第一則可見訊息的日期,停止捲動 1.2s 後淡出
    const top = el.getBoundingClientRect().top;
    for (const node of el.querySelectorAll("[data-msg-ts]")) {
      const r = (node as HTMLElement).getBoundingClientRect();
      if (r.bottom > top + 8) {
        setFloatingDate(chatDateLabel(Number((node as HTMLElement).dataset.msgTs)));
        break;
      }
    }
    if (floatingTimer.current) clearTimeout(floatingTimer.current);
    floatingTimer.current = setTimeout(() => setFloatingDate(null), 1200);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={listRef}
        onScroll={onScroll}
        className="tm-scroll flex h-full flex-col gap-3 overflow-x-hidden overflow-y-auto px-3 py-3"
      >
        {loadingOlder && (
          <p className="flex items-center justify-center gap-2 py-1 text-[11px] text-ink-faint">
            <Spinner className="size-3.5" /> 載入更早的對話…
          </p>
        )}
        {!hasMore && messages.length > 0 && (
          <p className="py-1 text-center text-[11px] text-ink-faint">— 對話從這裡開始 —</p>
        )}
        {messages.length === 0 && <EmptyChat />}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay =
            !prev || chatDateLabel(prev.createdAt) !== chatDateLabel(m.createdAt);
          return (
            <div key={m.id} data-msg-id={m.id} data-msg-ts={m.createdAt}>
              {newDay && (
                <p className="mb-3 flex justify-center">
                  <span className="tm-num rounded-full bg-sunken px-3 py-0.5 text-[11px] text-ink-faint">
                    {chatDateLabel(m.createdAt)}
                  </span>
                </p>
              )}
              <MessageRow message={m} />
            </div>
          );
        })}
      </div>
      {floatingDate && (
        <span className="tm-num tm-pop-in pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink/75 px-3 py-1 text-[11px] text-white shadow-pop backdrop-blur">
          {floatingDate}
        </span>
      )}
      {!stickBottom && unseen > 0 && (
        <button
          onClick={() => {
            setStickBottom(true);
            scrollToBottom(true);
          }}
          className="tm-pop-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs text-white shadow-lift"
        >
          <CaretDoubleDown className="size-3.5" />
          回到最新
        </button>
      )}
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-ocean-wash">
        <AgentFace className="flex size-10 items-center justify-center rounded-full" iconClassName="size-6" />
      </span>
      <p className="text-sm font-medium text-ink">跟塔比一起規劃這趟旅程</p>
      <p className="text-xs leading-relaxed text-ink-soft">
        試試:「幫我排第一天的行程」
        <br />
        「淺草寺到晴空塔有哪些交通方式?」
        <br />
        「有哪些景點需要先預約?」
      </p>
    </div>
  );
}

/** 塔比頭像:變身後顯示自訂頭貼,否則預設機器人。 */
function AgentFace({ className, iconClassName }: { className: string; iconClassName: string }) {
  const { agent } = useChat();
  const { tripId } = useSession();
  if (agent.identity.avatarVersion) {
    return (
      <img
        src={`/api/trips/${tripId}/agent/avatar?v=${agent.identity.avatarVersion}`}
        alt={agent.identity.name ?? "塔比"}
        className={cn(className, "overflow-hidden object-cover")}
      />
    );
  }
  return (
    <span className={cn(className, "bg-ocean text-white")}>
      <Robot weight="fill" className={iconClassName} />
    </span>
  );
}

/** 塔比目前的名字(變身後為自訂名稱)。 */
function useAgentName() {
  const { agent } = useChat();
  return agent.identity.name || "塔比";
}

const MessageRow = function MessageRow({ message }: { message: ChatMessage }) {
  const { me, memberOf } = useSession();

  if (message.role === "system") {
    return (
      <p className="mx-auto rounded-full bg-sunken px-3 py-1 text-center text-[11px] text-ink-faint">
        {message.content}
      </p>
    );
  }

  if (message.role === "user") {
    const author = memberOf(message.userId);
    const mine = message.userId === me?.id;
    return (
      <div className={cn("flex gap-2", mine && "flex-row-reverse")}>
        <Avatar user={author} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "flex items-baseline gap-2 text-[11px] text-ink-faint",
              mine && "flex-row-reverse",
            )}
          >
            <span className="font-medium text-ink-soft">{author.name}</span>
            <span className="tm-num">{clockLabel(message.createdAt)}</span>
            {message.status === "queued" && <Tag tone="neutral">排隊中</Tag>}
            {message.status === "stopped" && <Tag tone="neutral">已取消</Tag>}
          </p>
          <div
            className={cn(
              "mt-0.5 rounded-lg bg-sunken px-3 py-2 text-[13px] break-words [overflow-wrap:anywhere] text-ink",
              mine ? "rounded-tr-sm" : "rounded-tl-sm",
            )}
          >
            <MentionText content={message.content} mentions={message.mentions} />
            {message.attachmentIds.length > 0 && (
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {message.attachmentIds.map((id) => (
                  <ZoomableImage
                    key={id}
                    src={`/api/attachments/${id}/file`}
                    alt="附圖"
                    className="max-h-36 rounded-md border border-line object-contain"
                  />
                ))}
              </span>
            )}
          </div>
          <UserMessageActions message={message} />
        </div>
      </div>
    );
  }

  return <AgentMessage message={message} />;
};

/** 佇列中可取消、被停止的可重送(限本人訊息)。 */
function UserMessageActions({ message }: { message: ChatMessage }) {
  const { me, tripId } = useSession();
  const [busy, setBusy] = useState(false);
  if (message.userId !== me.id) return null;
  if (message.status !== "queued" && message.status !== "stopped") return null;

  const cancel = async () => {
    setBusy(true);
    await apiFetch(`/api/chat/messages/${message.id}/cancel`, { json: {} }).catch(() => {});
    setBusy(false);
  };
  const resend = async () => {
    setBusy(true);
    await apiFetch(`/api/trips/${tripId}/chat`, {
      json: { text: message.content, attachmentIds: message.attachmentIds, mentions: message.mentions },
    }).catch(() => {});
    setBusy(false);
  };

  return (
    <p className="mt-1 flex justify-end gap-3">
      {message.status === "queued" && (
        <button
          onClick={cancel}
          disabled={busy}
          className="tm-focus flex items-center gap-1 text-[11px] text-ink-faint transition-colors hover:text-alert"
        >
          <XCircle className="size-3.5" />
          取消
        </button>
      )}
      {message.status === "stopped" && (
        <button
          onClick={resend}
          disabled={busy}
          className="tm-focus flex items-center gap-1 text-[11px] text-ink-faint transition-colors hover:text-ocean-deep"
        >
          <ArrowClockwise className="size-3.5" />
          重送
        </button>
      )}
    </p>
  );
}

/** 連續 tool_status 分組:進行中=固定高度自動捲(無捲軸);完成=收合一行可展開。 */
function ToolRunGroup({
  items,
  live,
  ended,
}: {
  items: Array<{ block: Extract<ChatBlock, { kind: "tool_status" }>; idx: number }>;
  live: boolean;
  ended?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 進行中自動捲到最新
  useEffect(() => {
    if (live && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [live, items.length, items[items.length - 1]?.block.state]);

  if (items.length === 1 && !live) {
    return <ToolStatusBlock block={items[0].block} ended={ended} />;
  }

  if (live) {
    return (
      <div
        ref={boxRef}
        className="tm-noscrollbar flex max-h-[104px] flex-col gap-1.5 overflow-y-auto"
      >
        {items.map(({ block, idx }) => (
          <ToolStatusBlock key={idx} block={block} ended={ended} />
        ))}
      </div>
    );
  }

  const failed = items.filter((i) => i.block.state === "failed").length;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-sunken/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="tm-focus flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-ink-soft transition-colors hover:bg-sunken"
      >
        <Wrench weight="fill" className="size-3.5 shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate">
          查了 {items.length} 項資料
          {failed > 0 && `(${failed} 項改用其他方式)`}
        </span>
        <CaretDown
          weight="bold"
          className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <div className="flex flex-col gap-1.5 border-t border-line p-2">
          {items.map(({ block, idx }) => (
            <ToolStatusBlock key={idx} block={block} ended={ended} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 點引用 → 捲到原訊息並 highlight 一下。 */
function jumpToMessage(messageId: string) {
  const node = document.querySelector(`[data-msg-id="${messageId}"]`) as HTMLElement | null;
  if (!node) return;
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.classList.remove("tm-change-flash");
  void node.offsetWidth; // 重觸發動畫
  node.classList.add("tm-change-flash");
  setTimeout(() => node.classList.remove("tm-change-flash"), 1000);
}

/** LINE 式引用列:呈現被回覆訊息的摘要,可點跳轉。 */
function ReplyQuote({ message }: { message: ChatMessage }) {
  const { store } = useChat();
  const { memberOf } = useSession();
  // 舊訊息沒存 replyTo → 以前一則(seq-1)的使用者訊息代替
  const target =
    (message.replyToMessageId ? store.get(message.replyToMessageId) : undefined) ??
    store.getOrdered().find((m) => m.seq === message.seq - 1 && m.role === "user");
  if (!target || !target.content) return null;
  const author = memberOf(target.userId);
  return (
    <button
      onClick={() => jumpToMessage(target.id)}
      className="tm-focus mb-1.5 flex w-full items-center gap-1.5 rounded-md border-l-2 bg-ink/5 px-2 py-1 text-left transition-colors hover:bg-ink/10"
      style={{ borderLeftColor: author.color }}
      title="跳到原訊息"
    >
      <Avatar user={author} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] leading-tight font-medium" style={{ color: author.color }}>
          {author.name}
        </span>
        <span className="block truncate text-[11px] leading-tight text-ink-soft">
          {target.content}
        </span>
      </span>
    </button>
  );
}

function AgentMessage({ message }: { message: ChatMessage }) {
  const { store } = useChat();
  const { memberOf } = useSession();
  useSyncExternalStore(store.subscribeStream, store.streamVersion, store.streamVersion);
  const isLive = store.liveMessageId === message.id;
  const liveText = isLive ? store.liveText : "";
  const requester = message.userId ? memberOf(message.userId) : null;
  const agentMsgName = useAgentName();

  return (
    <div className="flex gap-2">
      <AgentFace className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full" iconClassName="size-4" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-[11px] text-ink-faint">
          <span className="font-medium text-ocean-deep">{agentMsgName}</span>
          {requester && <span>回應 {requester.name}</span>}
          <span className="tm-num">{clockLabel(message.createdAt)}</span>
          {message.status === "stopped" && <Tag tone="coral">已中止</Tag>}
        </p>
        <div className="mt-0.5 flex flex-col gap-2 rounded-lg rounded-tl-sm bg-ocean-wash/60 px-3 py-2.5">
          <ReplyQuote message={message} />
          {groupBlocks(message.blocks).map((group, gi) =>
            group.kind === "tools" ? (
              <ToolRunGroup
                key={`g${gi}`}
                items={group.items}
                live={
                  isLive &&
                  gi === groupBlocks(message.blocks).length - 1 &&
                  group.items.some((it) => it.block.state === "running")
                }
                ended={!isLive}
              />
            ) : (
              <BlockRenderer
                key={group.idx}
                block={group.block}
                messageId={message.id}
                idx={group.idx}
              />
            ),
          )}
          {isLive && liveText && (
            <div className="tm-stream-caret">
              <MiniMarkdown text={maskUnfinishedImage(liveText)} />
            </div>
          )}
          {isLive && <AgentActivityLine blocks={message.blocks} startedAt={message.createdAt} />}
          {message.status === "error" && message.error && (
            <p className="rounded-md bg-alert-wash px-2.5 py-1.5 text-xs text-alert">
              發生錯誤:{message.error.split("\n")[0]}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 塔比活動列(晴空假期風格):訊息進行中固定顯示在氣泡底部 —
 * ocean 膠囊 + 緩轉指南針 + 正在做什麼 + 呼吸小點;超過 8 秒才低調顯示經過時間。
 */
function AgentActivityLine({
  blocks,
  startedAt,
}: {
  blocks: ChatBlock[];
  startedAt: number;
}) {
  const { store } = useChat();
  useSyncExternalStore(store.subscribeStream, store.streamVersion, store.streamVersion);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const phase = store.agentPhase;
  if (phase === "idle") return null;
  const runningTool = [...blocks]
    .reverse()
    .find((b) => b.kind === "tool_status" && b.state === "running");
  const label =
    phase === "stopping"
      ? "收尾中"
      : runningTool && runningTool.kind === "tool_status"
        ? runningTool.label
        : phase === "thinking"
          ? "塔比翻著旅遊筆記"
          : "整理回覆";
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const time = secs >= 60 ? `${Math.floor(secs / 60)} 分 ${secs % 60} 秒` : `${secs} 秒`;
  return (
    <div className="mt-1 inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-ocean-wash py-1 pr-2.5 pl-2 text-[12px] text-ocean-deep">
      <CompassRose
        weight="fill"
        className="size-3.5 shrink-0 animate-[spin_3.5s_linear_infinite]"
      />
      <span className="min-w-0 truncate">{label}</span>
      <PulseDots className="shrink-0 scale-75" />
      {secs >= 8 && (
        <span className="tm-num shrink-0 text-ocean-deep/55 tm-pop-in">{time}</span>
      )}
    </div>
  );
}

function Composer({
  disabled,
  onSend,
  uploadRef,
}: {
  disabled: boolean;
  onSend: (text: string, attachmentIds: string[], mentions: ChatMention[]) => Promise<void>;
  uploadRef?: React.RefObject<{ upload: (f: File) => void } | null>;
}) {
  const { store } = useChat();
  const { tripId } = useSession();
  const { doc } = useTrip();
  const { activeDayId } = useSelection();
  useSyncExternalStore(store.subscribeStream, store.streamVersion, store.streamVersion);
  const busy = store.agentPhase !== "idle";

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [pickIdx, setPickIdx] = useState(0);
  // IME 拼字中:顯示原生文字(才看得到拼字底線),暫時藏染色層
  const [composing, setComposing] = useState(false);
  const allCandidates: MentionCandidate[] = doc ? buildCandidates(doc, activeDayId) : [];
  const candidates: MentionCandidate[] = trigger
    ? filterCandidates(allCandidates, trigger.query)
    : [];
  // 提及完全由文字推導:從選單選、或手動打出完整 @名稱,都算數(染色與送出同一規則)
  const mentions = resolveMentions(text, allCandidates);

  const detectTrigger = (v: string, caret: number) => {
    setTrigger(findMentionTrigger(v, caret));
    setPickIdx(0);
  };

  const pick = (c: MentionCandidate) => {
    if (!trigger) return;
    const before = text.slice(0, trigger.start);
    const after = text.slice(trigger.start + 1 + trigger.query.length);
    setText(`${before}@${c.label} ${after}`);
    setTrigger(null);
    setTimeout(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        const pos = before.length + c.label.length + 2;
        ta.setSelectionRange(pos, pos);
      }
      autosize();
    }, 0);
  };
  const [uploads, setUploads] = useState<
    Array<{ id: string; url: string; uploading: boolean }>
  >([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bdRef = useRef<HTMLDivElement>(null);

  // 輸入框內的 @ 提及染色(與送出判定同一份 resolveMentions 結果)
  const highlightSegments = (): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let pos = 0;
    for (const m of mentions) {
      const at = m.at;
      if (at < pos) continue;
      if (at > pos) parts.push(text.slice(pos, at));
      parts.push(
        <span
          key={`${m.kind}:${m.id}:${at}`}
          className={cn(
            "rounded-[3px] bg-ocean-wash",
            composing ? "text-transparent" : "text-ocean-deep",
          )}
        >
          @{m.label}
        </span>,
      );
      pos = at + m.label.length + 1;
    }
    if (pos < text.length) parts.push(text.slice(pos));
    return parts;
  };
  const fileRef = useRef<HTMLInputElement>(null);

  const autosize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  };

  const upload = async (file: File) => {
    const tempId = `up_${Math.random().toString(36).slice(2)}`;
    const preview = URL.createObjectURL(file);
    setUploads((u) => [...u, { id: tempId, url: preview, uploading: true }]);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/trips/${tripId}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { id: string; url: string };
      setUploads((u) =>
        u.map((x) => (x.id === tempId ? { id: data.id, url: preview, uploading: false } : x)),
      );
    } catch {
      setUploads((u) => u.filter((x) => x.id !== tempId));
    }
  };

  useEffect(() => {
    if (uploadRef) uploadRef.current = { upload };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadRef]);

  const send = async () => {
    const t = text.trim();
    const ready = uploads.filter((u) => !u.uploading).map((u) => u.id);
    if ((!t && ready.length === 0) || sending || disabled) return;
    setSending(true);
    try {
      await onSend(
        t,
        ready,
        mentions.map(({ kind, id, label }) => ({ kind, id, label })),
      );
      setText("");
      setTrigger(null);
      setUploads([]);
      setTimeout(autosize, 0);
    } finally {
      setSending(false);
    }
  };

  const stop = () => {
    // 終止當前任務;佇列中的訊息由 gateway 一併轉為可重送狀態
    apiFetch(`/api/trips/${tripId}/agent/stop`, { json: {} });
  };

  return (
    <div
      className="border-t border-line p-2.5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        for (const f of e.dataTransfer.files) if (f.type.startsWith("image/")) upload(f);
      }}
    >
      {uploads.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {uploads.map((u) => (
            <span key={u.id} className="relative">
              <img
                src={u.url}
                alt=""
                className={cn("h-14 rounded-md border border-line object-cover", u.uploading && "opacity-50")}
              />
              {u.uploading ? (
                <Spinner className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2" />
              ) : (
                <button
                  aria-label="移除附圖"
                  onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}
                  className="absolute -top-1.5 -right-1.5 flex size-4.5 items-center justify-center rounded-full bg-ink text-white"
                >
                  <X weight="bold" className="size-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="relative flex items-end gap-1.5">
        {trigger && (
          <MentionPicker items={candidates} activeIndex={pickIdx} onPick={pick} onHover={setPickIdx} />
        )}
        <button
          aria-label="附加圖片"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          className="tm-focus mb-1 shrink-0 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
        >
          <ImageSquare className="size-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            for (const f of e.target.files ?? []) upload(f);
            e.target.value = "";
          }}
        />
        <div className="relative min-w-0 flex-1 rounded-lg bg-surface">
          {/* @ 提及高亮層:與 textarea 同排版,只染色不改字重(避免兩層錯位) */}
          <div
            ref={bdRef}
            aria-hidden
            className={cn(
              "tm-scroll pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent px-3 py-1.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap",
              // 拼字中:文字交給原生層(才有拼字底線),染色層只留提及底色塊
              composing ? "text-transparent" : "text-ink",
            )}
          >
            {highlightSegments()}
            {"\u200b"}
          </div>
          <textarea
          ref={taRef}
          value={text}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? "塔比休息中" : "跟塔比討論行程…(Enter 送出)"}
          onChange={(e) => {
            setText(e.target.value);
            detectTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length);
            autosize();
          }}
          onClick={(e) => {
            const ta = e.currentTarget;
            detectTrigger(ta.value, ta.selectionStart ?? ta.value.length);
          }}
          onBlur={() => setTimeout(() => setTrigger(null), 120)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (trigger && candidates.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setPickIdx((i) => (i + 1) % candidates.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setPickIdx((i) => (i - 1 + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(candidates[pickIdx]);
                return;
              }
              if (e.key === "Escape") {
                setTrigger(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            for (const item of e.clipboardData.items) {
              if (item.type.startsWith("image/")) {
                const f = item.getAsFile();
                if (f) upload(f);
              }
            }
          }}
          onScroll={(e) => {
            if (bdRef.current) bdRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          className={cn(
            "tm-focus tm-scroll relative min-h-9 w-full resize-none rounded-lg border border-line bg-transparent px-3 py-1.5 text-[13px] leading-relaxed caret-ink placeholder:text-ink-faint focus-visible:border-ocean focus-visible:ring-2 focus-visible:ring-ocean/25 focus-visible:outline-none disabled:opacity-50",
            composing ? "text-ink" : "text-transparent",
          )}
        />
        </div>
        {busy ? (
          <span className="mb-0.5 flex shrink-0 items-center gap-1.5">
            {(text.trim() || uploads.some((u) => !u.uploading)) && (
              <button
                aria-label="送出(排入佇列)"
                disabled={sending}
                onClick={send}
                className="tm-focus flex size-9 items-center justify-center rounded-full bg-ocean text-white shadow-[0_2px_8px_-2px_rgb(14_155_164/0.5)] transition-transform hover:bg-ocean-deep active:scale-90 disabled:opacity-40"
              >
                {sending ? <Spinner className="size-4 text-white" /> : <PaperPlaneRight weight="fill" className="size-4" />}
              </button>
            )}
            <button
              aria-label="停止"
              onClick={stop}
              className={cn(
                "tm-focus flex size-9 items-center justify-center rounded-full bg-coral-wash text-coral-deep transition-[transform,background-color] hover:bg-coral hover:text-white active:scale-90",
                store.agentPhase === "stopping" && "pointer-events-none opacity-60",
              )}
            >
              {store.agentPhase === "stopping" ? (
                <Spinner className="size-4 text-coral-deep" />
              ) : (
                <StopIcon weight="fill" className="size-4" />
              )}
            </button>
          </span>
        ) : (
          <button
            aria-label="送出"
            disabled={disabled || sending || (!text.trim() && uploads.every((u) => u.uploading))}
            onClick={send}
            className="tm-focus mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-ocean text-white shadow-[0_2px_8px_-2px_rgb(14_155_164/0.5)] transition-transform hover:bg-ocean-deep active:scale-90 disabled:opacity-40"
          >
            {sending ? (
              <Spinner className="size-4 text-white" />
            ) : (
              <PaperPlaneRight weight="fill" className="size-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}


type BlockGroup =
  | { kind: "tools"; items: Array<{ block: Extract<ChatBlock, { kind: "tool_status" }>; idx: number }> }
  | { kind: "single"; block: ChatBlock; idx: number };

function groupBlocks(blocks: ChatBlock[]): BlockGroup[] {
  const out: BlockGroup[] = [];
  blocks.forEach((block, idx) => {
    if (block.kind === "tool_status") {
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.items.push({ block, idx });
      else out.push({ kind: "tools", items: [{ block, idx }] });
    } else {
      out.push({ kind: "single", block, idx });
    }
  });
  return out;
}
