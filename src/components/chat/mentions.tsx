"use client";

// 聊天 @ 提及:輸入框自動完成(指名天/地點/交通給塔比)+ 氣泡內 chip 樣式與點擊跳轉。
import { CalendarBlank, MapPin, TrainSimple } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { dayDateLabel } from "@/lib/dates";
import type { ChatMention, Itinerary } from "@/shared/types";
import { useSelection, useTrip } from "@/lib/workspace/WorkspaceProvider";

export type MentionCandidate = ChatMention & { hint: string };

const KIND_ICON = {
  day: CalendarBlank,
  stop: MapPin,
  leg: TrainSimple,
} as const;

/** 從行程組出全部可提及對象(天/地點/交通)。 */
export function buildCandidates(doc: Itinerary, activeDayId: string | null): MentionCandidate[] {
  const days = [...doc.days].sort((a, b) => a.position - b.position);
  const dayIdxOf = new Map(days.map((d, i) => [d.id, i]));
  const stopById = new Map(doc.stops.map((s) => [s.id, s]));
  const out: MentionCandidate[] = [];

  for (const [i, d] of days.entries()) {
    out.push({
      kind: "day",
      id: d.id,
      label: `Day ${i + 1}`,
      hint: dayDateLabel(doc.trip.startDate, i) ?? d.title ?? "",
    });
  }
  const stops = [...doc.stops].sort(
    (a, b) =>
      (dayIdxOf.get(a.dayId) ?? 0) - (dayIdxOf.get(b.dayId) ?? 0) || a.position - b.position,
  );
  for (const s of stops) {
    out.push({
      kind: "stop",
      id: s.id,
      label: s.name,
      hint: `Day ${(dayIdxOf.get(s.dayId) ?? 0) + 1}${s.startTime ? ` · ${s.startTime}` : ""}`,
    });
  }
  for (const l of doc.legs) {
    const from = stopById.get(l.fromStopId);
    const to = stopById.get(l.toStopId);
    if (!from || !to) continue;
    out.push({
      kind: "leg",
      id: l.fromStopId,
      label: `${from.name}→${to.name}`,
      hint: `Day ${(dayIdxOf.get(from.dayId) ?? 0) + 1} · 交通`,
    });
  }
  // 目前開啟的那天優先(query 為空時最常指名當天的東西)
  const dayRank = (m: MentionCandidate) => {
    const dayId =
      m.kind === "day" ? m.id : m.kind === "stop" ? stopById.get(m.id)?.dayId : stopById.get(m.id)?.dayId;
    return dayId === activeDayId ? 0 : 1;
  };
  return out.sort((a, b) => dayRank(a) - dayRank(b));
}

export function filterCandidates(all: MentionCandidate[], query: string): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  const hit = q
    ? all.filter(
        (c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q),
      )
    : all;
  return hit.slice(0, 8);
}

/** 游標前是否正在打 @xxx(@ 需在行首或空白後)。 */
export function findMentionTrigger(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const at = text.lastIndexOf("@", caret - 1);
  if (at === -1) return null;
  if (at > 0 && !/[\s(,、,]/.test(text[at - 1])) return null;
  const query = text.slice(at + 1, caret);
  if (query.length > 24 || query.includes("\n") || query.includes("@")) return null;
  return { start: at, query };
}

/** 輸入框上方的候選清單。 */
export function MentionPicker({
  items,
  activeIndex,
  onPick,
  onHover,
}: {
  items: MentionCandidate[];
  activeIndex: number;
  onPick: (c: MentionCandidate) => void;
  onHover: (i: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="tm-pop-in absolute right-0 bottom-full left-0 z-30 mb-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
      <p className="border-b border-line px-3 py-1.5 text-[11px] text-ink-faint">
        指名給塔比 — 天數、地點或交通
      </p>
      <ul className="tm-scroll max-h-56 overflow-y-auto py-1">
        {items.map((c, i) => {
          const Icon = KIND_ICON[c.kind];
          return (
            <li key={`${c.kind}:${c.id}`}>
              <button
                // 用 pointerdown 搶在 textarea blur 前完成選取
                onPointerDown={(e) => {
                  e.preventDefault();
                  onPick(c);
                }}
                onMouseEnter={() => onHover(i)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[13px]",
                  i === activeIndex ? "bg-ocean-wash text-ocean-deep" : "text-ink",
                )}
              >
                <Icon
                  weight={c.kind === "day" ? "fill" : "regular"}
                  className={cn("size-3.5 shrink-0", i === activeIndex ? "text-ocean-deep" : "text-ink-faint")}
                />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">{c.hint}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 訊息氣泡內容:把 @提及 渲染成 chip,點擊跳轉到該項目。 */
export function MentionText({
  content,
  mentions,
}: {
  content: string;
  mentions: ChatMention[];
}) {
  const { doc } = useTrip();
  const { setActiveDay, setSelectedStop } = useSelection();
  if (mentions.length === 0) return <>{content}</>;

  const jump = (m: ChatMention) => {
    if (!doc) return;
    if (m.kind === "day") {
      if (doc.days.some((d) => d.id === m.id)) setActiveDay(m.id);
      return;
    }
    const stop = doc.stops.find((s) => s.id === m.id);
    if (!stop) return;
    setActiveDay(stop.dayId);
    setSelectedStop(stop.id);
  };

  // 依出現位置切段,@label 段落換成 chip
  const marks = mentions
    .map((m) => ({ m, at: content.indexOf(`@${m.label}`) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const { m, at } of marks) {
    if (at < pos) continue; // 重疊(同 label 多次提及只標第一次)
    if (at > pos) parts.push(content.slice(pos, at));
    const Icon = KIND_ICON[m.kind];
    parts.push(
      <button
        key={`${m.kind}:${m.id}:${at}`}
        onClick={() => jump(m)}
        title="前往這個項目"
        className="tm-focus mx-0.5 inline-flex max-w-56 cursor-pointer items-center gap-0.5 rounded-md bg-ocean-wash px-1 py-px align-baseline text-[12px] font-medium text-ocean-deep transition-colors hover:bg-ocean hover:text-white"
      >
        <Icon weight="fill" className="size-3 shrink-0" />
        <span className="truncate">{m.label}</span>
      </button>,
    );
    pos = at + m.label.length + 1;
  }
  if (pos < content.length) parts.push(content.slice(pos));
  return <>{parts}</>;
}
