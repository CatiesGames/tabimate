"use client";

// agent 訊息的 block 渲染器:結構化卡片,不是裸 markdown。
import { useEffect, useState } from "react";
import {
  ArrowSquareOut,
  CalendarCheck,
  Check,
  CheckCircle,
  ListChecks,
  Robot,
  SealCheck,
  Ticket,
  Warning,
  X,
} from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { LEG_MODE_ICON } from "@/lib/categories";
import { cn } from "@/lib/cn";
import type { ChatBlock, Proposal } from "@/shared/types";
import type { Operation } from "@/shared/changeset";
import {
  useProposals,
  useSelection,
  useSession,
  useTrip,
} from "@/lib/workspace/WorkspaceProvider";
import { Avatar, Button, Spinner, Tag, ZoomableImage } from "@/components/ui";

export function BlockRenderer({
  block,
  messageId,
  idx,
}: {
  block: ChatBlock;
  messageId: string;
  idx: number;
}) {
  switch (block.kind) {
    case "text":
      return <MiniMarkdown text={block.text} />;
    case "tool_status":
      return <ToolStatusBlock block={block} />;
    case "transit_options":
      return <TransitOptionsBlock block={block} messageId={messageId} idx={idx} />;
    case "choices":
      return <ChoicesBlock block={block} messageId={messageId} idx={idx} />;
    case "proposal":
      return <ProposalBlock proposalId={block.proposalId} />;
    case "verification":
      return <VerificationBlock block={block} />;
    case "booking_audit":
      return <BookingAuditBlock block={block} />;
    case "image":
      return (
        <ZoomableImage
          src={block.url}
          alt="附圖"
          className="max-h-56 max-w-full rounded-lg border border-line object-contain"
        />
      );
    case "error":
      return (
        <p className="flex items-center gap-1.5 rounded-md bg-alert-wash px-2.5 py-1.5 text-xs text-alert">
          <Warning weight="fill" className="size-3.5 shrink-0" />
          {block.message}
        </p>
      );
    default:
      return null;
  }
}

/** 串流中把結尾「未閉合的圖片語法」遮成佔位,避免長 photo ref 原文在打字過程閃現。 */
export function maskUnfinishedImage(text: string): string {
  const at = text.lastIndexOf("![");
  if (at === -1) return text;
  if (/^!\[[^\]]*\]\([^)]*\)/.test(text.slice(at))) return text; // 已閉合,照常渲染
  return `${text.slice(0, at)}(附圖…)`;
}

// ---- 迷你 markdown(粗體/代碼/連結/圖片/清單/標題)----

/**
 * 聊天內嵌圖片:gphoto:<ref> 走自家 Google 照片代理(快取、不破圖、與詳情共用額度);
 * 一般 https 圖片直接渲染,載入失敗自動隱藏。其他協定一律不渲染。
 */
function MdImage({ alt, src }: { alt: string; src: string }) {
  if (!src.startsWith("gphoto:") && !src.startsWith("https://")) return null;
  const url = src.startsWith("gphoto:")
    ? `/api/google/photo?ref=${encodeURIComponent(src.slice(7))}&w=400`
    : src;
  const zoom = src.startsWith("gphoto:")
    ? `/api/google/photo?ref=${encodeURIComponent(src.slice(7))}&w=1000`
    : url;
  return (
    <ZoomableImage
      src={url}
      zoomSrc={zoom}
      alt={alt}
      hideOnError
      wrapperClassName="my-1 mr-1.5 inline-block"
      className="h-32 max-w-60 rounded-md border border-line object-cover"
    />
  );
}


function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${k++}`;
    if (tok.startsWith("![")) {
      const mm = /!\[([^\]]*)\]\(([^)]+)\)/.exec(tok)!;
      out.push(<MdImage key={key} alt={mm[1]} src={mm[2]} />);
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.85em] break-all">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      out.push(
        <a key={key} href={mm[2]} target="_blank" rel="noreferrer" className="text-ocean-deep underline">
          {mm[1]}
        </a>,
      );
    } else {
      out.push(
        <a key={key} href={tok} target="_blank" rel="noreferrer" className="break-all text-ocean-deep underline">
          {tok}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push(
      <ul key={`ul${key++}`} className="my-1 flex list-none flex-col gap-0.5 pl-1">
        {listBuf.map((item, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="mt-[0.45em] size-1 shrink-0 rounded-full bg-coral" />
            <span>{inline(item, `li${key}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    );
    listBuf = [];
  };

  for (const line of lines) {
    const t = line.trim();
    if (/^[-*] /.test(t)) {
      listBuf.push(t.slice(2));
      continue;
    }
    flushList();
    if (t.startsWith("### ") || t.startsWith("## ") || t.startsWith("# ")) {
      out.push(
        <p key={`h${key++}`} className="mt-1.5 font-semibold text-ink">
          {inline(t.replace(/^#+\s/, ""), `h${key}`)}
        </p>,
      );
    } else if (t === "") {
      out.push(<span key={`b${key++}`} className="block h-1.5" />);
    } else {
      out.push(
        <p key={`p${key++}`} className="leading-relaxed">
          {inline(line, `p${key}`)}
        </p>,
      );
    }
  }
  flushList();
  return <div className="text-[13px] text-ink break-words [overflow-wrap:anywhere]">{out}</div>;
}

// ---- 工具狀態 ----

export function ToolStatusBlock({
  block,
}: {
  block: Extract<ChatBlock, { kind: "tool_status" }>;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-1.5 text-xs",
        block.state === "running" && "border-ocean/30 bg-ocean-wash text-ocean-deep",
        block.state === "done" && "border-line bg-sunken/60 text-ink-faint",
        block.state === "failed" && "border-sun/50 bg-sun-wash text-sun-deep",
      )}
    >
      <div className="flex items-center gap-2">
        {block.state === "running" ? (
          <Spinner className="size-3.5" />
        ) : block.state === "done" ? (
          <Check weight="bold" className="size-3.5 text-leaf" />
        ) : (
          <Warning weight="fill" className="size-3.5" />
        )}
        <span
          className={cn(
            block.state === "running" &&
              "bg-[linear-gradient(90deg,currentColor_40%,rgba(14,155,164,0.35)_50%,currentColor_60%)] bg-[length:200%_100%] bg-clip-text animate-[tm-shimmer_1.8s_linear_infinite]",
          )}
        >
          {block.label}
          {block.state === "failed" && " — 這次沒成功,塔比會自行調整"}
        </span>
      </div>
      {block.state === "failed" && block.detail && (
        <p className="mt-1 pl-5.5 text-[11px] leading-relaxed opacity-80">
          原因:{block.detail}
        </p>
      )}
    </div>
  );
}

// ---- 交通選項比較卡 ----

function TransitOptionsBlock({
  block,
  messageId,
  idx,
}: {
  block: Extract<ChatBlock, { kind: "transit_options" }>;
  messageId: string;
  idx: number;
}) {
  const { tripId, memberOf } = useSession();
  const [choosing, setChoosing] = useState<number | null>(null);
  const resolved = block.selectedIndex !== null;

  const choose = async (optionIndex: number) => {
    if (resolved || choosing !== null) return;
    setChoosing(optionIndex);
    try {
      await apiFetch(`/api/trips/${tripId}/chat/select-transit`, {
        json: { messageId, idx, optionIndex },
      });
    } catch {
      // 失敗或已被選走:WS 會帶來最終狀態
    } finally {
      setChoosing(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <p className="border-b border-line bg-sunken/50 px-3 py-2 text-xs font-medium text-ink-soft">
        {block.from} <span className="text-ink-faint">→</span> {block.to} 的交通方式
      </p>
      <div className="flex flex-col gap-1.5 p-2">
        {block.options.map((opt, i) => {
          const Icon = LEG_MODE_ICON[opt.mode] ?? LEG_MODE_ICON.other;
          const isChosen = block.selectedIndex === i;
          const dimmed = resolved && !isChosen;
          return (
            <button
              key={i}
              disabled={resolved || choosing !== null}
              onClick={() => choose(i)}
              className={cn(
                "tm-focus relative rounded-lg border p-2.5 text-left transition-[border-color,box-shadow,opacity,transform] duration-150",
                isChosen
                  ? "border-leaf bg-leaf-wash"
                  : dimmed
                    ? "border-line opacity-45"
                    : "border-line hover:border-ocean/50 hover:shadow-card active:scale-[0.99]",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-white",
                    isChosen ? "bg-leaf" : "bg-ocean",
                  )}
                >
                  <Icon weight="fill" className="size-4" />
                </span>
                <span className="text-sm font-medium text-ink">{opt.label}</span>
                {opt.recommended && !resolved && <Tag tone="sun">推薦</Tag>}
                <span className="tm-num ml-auto text-sm font-semibold text-ink">
                  {opt.durationMin} 分
                </span>
              </div>
              <p className="mt-1 pl-9 text-xs text-ink-soft">{opt.summary}</p>
              <p className="tm-num mt-0.5 flex flex-wrap gap-x-3 pl-9 text-[11px] text-ink-faint">
                {opt.departureTime && opt.arrivalTime && (
                  <span>
                    {opt.departureTime} → {opt.arrivalTime}
                  </span>
                )}
                {opt.fare && <span>{opt.fare}</span>}
                {opt.transfers != null && <span>轉乘 {opt.transfers} 次</span>}
              </p>
              {choosing === i && (
                <span className="absolute right-2 bottom-2">
                  <Spinner className="size-4" />
                </span>
              )}
              {isChosen && block.selectedByUserId && (
                <span className="mt-1.5 flex items-center gap-1 pl-9 text-[11px] font-medium text-leaf-deep">
                  <Avatar user={memberOf(block.selectedByUserId)} size="xs" />
                  已選擇並套用
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- 通用選項卡(agent 請成員做決策;點選即記錄+套用)----

function ChoicesBlock({
  block,
  messageId,
  idx,
}: {
  block: Extract<ChatBlock, { kind: "choices" }>;
  messageId: string;
  idx: number;
}) {
  const { tripId, memberOf } = useSession();
  const [choosing, setChoosing] = useState<number | null>(null);
  const resolved = block.selectedIndex !== null;

  const choose = async (optionIndex: number) => {
    if (resolved || choosing !== null) return;
    setChoosing(optionIndex);
    try {
      await apiFetch(`/api/trips/${tripId}/chat/select-choice`, {
        json: { messageId, idx, optionIndex },
      });
    } catch {
      // 失敗或已被選走:WS 會帶來最終狀態
    } finally {
      setChoosing(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <p className="flex items-center gap-2 border-b border-line bg-sunken/50 px-3 py-2 text-[13px] font-medium text-ink">
        <ListChecks weight="fill" className="size-4 shrink-0 text-ocean" />
        {block.question}
      </p>
      <div className="flex flex-col gap-1.5 p-2">
        {block.options.map((opt, i) => {
          const isChosen = block.selectedIndex === i;
          const dimmed = resolved && !isChosen;
          const hasOps = (opt.operations?.length ?? 0) > 0;
          return (
            <button
              key={i}
              disabled={resolved || choosing !== null}
              onClick={() => choose(i)}
              className={cn(
                "tm-focus relative rounded-lg border p-2.5 text-left transition-[border-color,box-shadow,opacity,transform] duration-150",
                isChosen
                  ? "border-leaf bg-leaf-wash"
                  : dimmed
                    ? "border-line opacity-45"
                    : "border-line hover:border-ocean/50 hover:shadow-card active:scale-[0.99]",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "tm-num flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white",
                    isChosen ? "bg-leaf" : "bg-ocean",
                  )}
                >
                  {isChosen ? <Check weight="bold" className="size-3" /> : i + 1}
                </span>
                <span className="text-sm font-medium text-ink">{opt.label}</span>
                {choosing === i && <Spinner className="ml-auto size-4" />}
              </span>
              {opt.description && (
                <p className="mt-1 pl-7 text-xs text-ink-soft">{opt.description}</p>
              )}
              {isChosen && block.selectedByUserId && (
                <span className="mt-1.5 flex items-center gap-1 pl-7 text-[11px] font-medium text-leaf-deep">
                  <Avatar user={memberOf(block.selectedByUserId)} size="xs" />
                  {memberOf(block.selectedByUserId).name} 已選擇
                  {hasOps && " · 變更已套用"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- 提案卡(diff 預覽 + 確認/拒絕)----

const resolvedCache = new Map<string, Proposal>();

function ProposalBlock({ proposalId }: { proposalId: string }) {
  const { tripId, memberOf } = useSession();
  const { pending, confirm, reject } = useProposals();
  const { doc } = useTrip();
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  const [resolved, setResolved] = useState<Proposal | null>(
    resolvedCache.get(proposalId) ?? null,
  );

  const pendingProposal = pending.find((p) => p.id === proposalId);
  const proposal = pendingProposal ?? resolved;

  // 不在 pending → 抓最終狀態
  useEffect(() => {
    if (pendingProposal || resolved) return;
    apiFetch<{ proposals: Proposal[] }>(`/api/trips/${tripId}/proposals`)
      .then((d) => {
        for (const p of d.proposals) resolvedCache.set(p.id, p);
        const hit = d.proposals.find((p) => p.id === proposalId);
        if (hit) setResolved(hit);
      })
      .catch(() => {});
  }, [pendingProposal, resolved, proposalId, tripId]);

  // pending → resolved 轉換時刷新
  useEffect(() => {
    if (!pendingProposal && resolved?.status === "pending") {
      resolvedCache.delete(proposalId);
      setResolved(null);
    }
  }, [pendingProposal, resolved, proposalId]);

  if (!proposal) {
    return <div className="tm-skeleton h-20 rounded-xl" />;
  }

  const requester = proposal.requestedByUserId
    ? memberOf(proposal.requestedByUserId)
    : null;
  const isPending = proposal.status === "pending";

  const act = async (kind: "confirm" | "reject") => {
    setBusy(kind);
    try {
      if (kind === "confirm") await confirm(proposal.id);
      else await reject(proposal.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border",
        isPending ? "border-coral/40 bg-surface shadow-card" : "border-line bg-surface",
      )}
    >
      <div className="flex items-center gap-2 border-b border-line bg-coral-wash/40 px-3 py-2">
        <Robot weight="fill" className="size-4 text-ocean" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {proposal.summary}
        </span>
        {requester && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
            <Avatar user={requester} size="xs" />
            發起
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1 px-3 py-2">
        {(proposal.operations as Operation[]).slice(0, 8).map((op, i) => (
          <OpRow
            key={i}
            op={op}
            allOps={proposal.operations as Operation[]}
            docStops={doc?.stops ?? []}
          />
        ))}
        {(proposal.operations as Operation[]).length > 8 && (
          <li className="text-[11px] text-ink-faint">
            …共 {(proposal.operations as Operation[]).length} 項變更
          </li>
        )}
      </ul>

      <div className="flex items-center justify-between border-t border-line px-3 py-2">
        {isPending ? (
          <>
            <span className="text-[11px] text-ink-faint">任何成員都可以裁決</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                loading={busy === "reject"}
                disabled={busy !== null}
                onClick={() => act("reject")}
              >
                <X className="size-3.5" />
                拒絕
              </Button>
              <Button
                size="sm"
                loading={busy === "confirm"}
                disabled={busy !== null}
                onClick={() => act("confirm")}
              >
                <Check weight="bold" className="size-3.5" />
                確認套用
              </Button>
            </div>
          </>
        ) : (
          <ResolvedState proposal={proposal} />
        )}
      </div>
    </div>
  );
}

function ResolvedState({ proposal }: { proposal: Proposal }) {
  const { memberOf } = useSession();
  const by = proposal.resolvedByUserId ? memberOf(proposal.resolvedByUserId) : null;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      {proposal.status === "applied" && (
        <>
          <CheckCircle weight="fill" className="size-4 text-leaf" />
          <span className="text-leaf-deep">
            已套用{by && ` · ${by.name} 確認`}
          </span>
        </>
      )}
      {proposal.status === "rejected" && (
        <>
          <X weight="bold" className="size-3.5 text-ink-faint" />
          <span className="text-ink-faint">
            已拒絕{by && ` · ${by.name}`}
            {proposal.resolutionNote && `:${proposal.resolutionNote}`}
          </span>
        </>
      )}
      {proposal.status === "failed_conflict" && (
        <>
          <Warning weight="fill" className="size-4 text-alert" />
          <span className="text-alert">行程已變動,套用失敗 — 請 AI 重新評估</span>
        </>
      )}
      {proposal.status === "superseded" && (
        <span className="text-ink-faint">已被新提案取代</span>
      )}
    </span>
  );
}

function OpRow({
  op,
  allOps,
  docStops,
}: {
  op: Operation;
  allOps: Operation[];
  docStops: Array<{ id: string; name: string }>;
}) {
  const nameOf = (ref: string) => {
    if (ref.startsWith("$")) {
      // 同一批提案裡用 $tempId 新建的地點 → 從 add_stop 取名稱
      const t = ref.slice(1);
      const added = allOps.find(
        (o): o is Extract<Operation, { op: "add_stop" }> =>
          o.op === "add_stop" && o.tempId === t,
      );
      return added?.name ?? "新地點";
    }
    return docStops.find((s) => s.id === ref)?.name ?? "(已不存在的地點)";
  };

  let icon: React.ReactNode = null;
  let text = "";
  let tone = "text-ink-soft";
  switch (op.op) {
    case "add_day":
      icon = <span className="font-bold text-leaf">＋</span>;
      text = `新增一天${op.title ? `「${op.title}」` : ""}`;
      tone = "text-leaf-deep";
      break;
    case "remove_day":
      icon = <span className="font-bold text-alert">－</span>;
      text = "移除一天(含當天所有地點)";
      tone = "text-alert";
      break;
    case "move_day":
      icon = <span className="text-sun-deep">⇄</span>;
      text = "調整天數順序";
      break;
    case "update_day":
      icon = <span className="text-ink-faint">✎</span>;
      text = "更新天標題/備註";
      break;
    case "add_stop":
      icon = <span className="font-bold text-leaf">＋</span>;
      text = `新增「${op.name}」${op.startTime ? ` ${op.startTime}` : ""}`;
      tone = "text-leaf-deep";
      break;
    case "remove_stop":
      icon = <span className="font-bold text-alert">－</span>;
      text = `移除「${nameOf(op.stopId)}」`;
      tone = "text-alert";
      break;
    case "move_stop":
      icon = <span className="text-sun-deep">⇄</span>;
      text = `移動「${nameOf(op.stopId)}」`;
      tone = "text-sun-deep";
      break;
    case "update_stop": {
      icon = <span className="text-ink-faint">✎</span>;
      const p = op.patch as Record<string, unknown>;
      const parts: string[] = [];
      if (p.startTime) parts.push(`時間 ${p.startTime}`);
      if (p.bookingType) parts.push("預約標記");
      if (p.notes) parts.push("備註");
      if (p.name) parts.push(`改名「${p.name}」`);
      text = `更新「${nameOf(op.stopId)}」${parts.length ? `:${parts.join("、")}` : ""}`;
      break;
    }
    case "set_leg":
      icon = <span className="text-ocean">⇢</span>;
      text = `設定「${nameOf(op.fromStopId)}」出發交通${op.departureTime ? `(${op.departureTime} 出發)` : ""}`;
      tone = "text-ocean-deep";
      break;
    case "remove_leg":
      icon = <span className="font-bold text-alert">－</span>;
      text = `清除「${nameOf(op.fromStopId)}」出發交通`;
      break;
    case "set_verification":
      icon = <SealCheck weight="fill" className="size-3.5 text-leaf" />;
      text = `記錄「${nameOf(op.stopId)}」查證結果`;
      break;
    case "update_trip":
      icon = <span className="text-ink-faint">✎</span>;
      text = "更新行程資訊";
      break;
  }
  return (
    <li className={cn("flex items-center gap-2 text-xs", tone)}>
      <span className="flex w-4 justify-center">{icon}</span>
      {text}
    </li>
  );
}

// ---- 查證卡 ----

function VerificationBlock({
  block,
}: {
  block: Extract<ChatBlock, { kind: "verification" }>;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border",
        block.verdict === "confirmed" && "border-leaf/40",
        block.verdict === "mismatch" && "border-alert/40",
        block.verdict === "unknown" && "border-line",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-[13px] font-medium",
          block.verdict === "confirmed" && "bg-leaf-wash text-leaf-deep",
          block.verdict === "mismatch" && "bg-alert-wash text-alert",
          block.verdict === "unknown" && "bg-sunken text-ink-soft",
        )}
      >
        {block.verdict === "confirmed" ? (
          <SealCheck weight="fill" className="size-4" />
        ) : (
          <Warning weight="fill" className="size-4" />
        )}
        {block.place} ·{" "}
        {block.verdict === "confirmed"
          ? "查證無誤"
          : block.verdict === "mismatch"
            ? "與行程安排衝突"
            : "查不到可靠資訊"}
      </p>
      <div className="flex flex-col gap-1.5 px-3 py-2">
        {block.note && <p className="text-xs text-ink-soft">{block.note}</p>}
        {block.hours && block.hours.length > 0 && (
          <ul className="tm-num rounded-md bg-sunken px-2.5 py-1.5 text-[11px] text-ink-soft">
            {block.hours.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        {block.sources.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {block.sources.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-0.5 text-ocean-deep hover:underline"
              >
                <ArrowSquareOut className="size-3" />
                {s.title}
              </a>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

// ---- 預約稽核卡 ----

function BookingAuditBlock({
  block,
}: {
  block: Extract<ChatBlock, { kind: "booking_audit" }>;
}) {
  const { setActiveDay, setSelectedStop } = useSelection();
  const { doc } = useTrip();
  return (
    <div className="overflow-hidden rounded-xl border border-sun/40">
      <p className="flex items-center gap-2 bg-sun-wash px-3 py-2 text-[13px] font-medium text-sun-deep">
        <Ticket weight="fill" className="size-4" />
        預約/購票稽核
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {block.items.map((item, i) => {
          const stop = item.stopId ? doc?.stops.find((s) => s.id === item.stopId) : null;
          return (
            <li
              key={i}
              className={cn("px-3 py-2", stop && "cursor-pointer hover:bg-sunken/60")}
              onClick={() => {
                if (stop) {
                  setActiveDay(stop.dayId);
                  setSelectedStop(stop.id);
                }
              }}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                  {item.name}
                  {item.dayLabel && (
                    <span className="ml-1 text-[11px] text-ink-faint">{item.dayLabel}</span>
                  )}
                </span>
                {item.bookingStatus === "booked" ? (
                  <Tag tone="leaf">
                    <CalendarCheck weight="fill" className="size-3" />
                    已預約
                  </Tag>
                ) : item.bookingType === "reservation_required" ? (
                  <Tag tone="sun">需預約</Tag>
                ) : item.bookingType === "ticket_required" ? (
                  <Tag tone="ocean">需購票</Tag>
                ) : item.bookingType === "recommended" ? (
                  <Tag>建議預約</Tag>
                ) : item.bookingType === "walk_in_queue" ? (
                  <Tag>現場排隊</Tag>
                ) : (
                  <Tag tone="leaf">免預約</Tag>
                )}
              </div>
              <p className="mt-0.5 text-xs text-ink-soft">{item.requirement}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-ink-faint">
                {item.deadline && <span className="tm-num">截止/開賣:{item.deadline}</span>}
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-0.5 text-ocean-deep hover:underline"
                  >
                    <ArrowSquareOut className="size-3" />
                    訂票連結
                  </a>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
