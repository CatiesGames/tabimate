"use client";

// 塔比的靈魂與記憶:點聊天室塔比頭貼開啟。
// 這裡的每一條都會注入塔比每一輪的系統提示(重置對話也不忘);可手動新增/編輯/刪除。
import { useEffect, useState } from "react";
import { Brain, PencilSimple, Plus, Robot, Sparkle, Trash, X } from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useChat, useSession } from "@/lib/workspace/WorkspaceProvider";
import type { AgentMemory } from "@/shared/types";
import { Button, Input, Spinner } from "@/components/ui";

export function TabiSoulDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tripId } = useSession();
  const { agent } = useChat();
  const [items, setItems] = useState<AgentMemory[] | null>(null);

  const load = async () => {
    const res = await apiFetch<{ memories: AgentMemory[] }>(
      `/api/trips/${tripId}/agent/memories`,
    );
    setItems(res.memories);
  };
  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const personas = (items ?? []).filter((m) => m.kind === "persona");
  const memories = (items ?? []).filter((m) => m.kind === "memory");

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="tm-pop-in tm-scroll absolute top-0 right-0 flex h-full w-[400px] max-w-[94vw] flex-col overflow-y-auto border-l border-line bg-surface shadow-pop">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
            <span className="flex size-7 items-center justify-center rounded-full bg-ocean text-white">
              <Robot weight="fill" className="size-4" />
            </span>
            塔比的靈魂與記憶
          </h2>
          <button
            aria-label="關閉"
            onClick={onClose}
            className="tm-focus rounded-sm p-1 text-ink-faint hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        {(agent.identity.name || agent.identity.avatarVersion) && (
          <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-lg bg-ocean-wash/60 px-3 py-2">
            <span className="min-w-0 flex-1 text-[13px] text-ink">
              目前變身為<span className="font-semibold">{agent.identity.name || "(自訂頭貼)"}</span>
              {agent.identity.rolePersona && (
                <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-soft">
                  {agent.identity.rolePersona}
                </span>
              )}
            </span>
            <button
              onClick={() => apiFetch(`/api/trips/${tripId}/agent/identity/reset`, { json: {} })}
              className="tm-focus shrink-0 rounded-md bg-surface px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-sunken"
            >
              恢復預設塔比
            </button>
          </div>
        )}
        <p className="px-4 pt-3 text-[12px] leading-relaxed text-ink-faint">
          這裡的每一條都會跟著塔比的每一輪對話(重置對話也不會忘)。可以直接在聊天裡請塔比記住,
          它會出確認卡;也可以在這裡手動調整。
        </p>

        {items === null ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-5" />
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            <MemorySection
              title="基礎個性"
              icon={<Sparkle weight="fill" className="size-4 text-coral" />}
              hint="不隨變身改變的說話方式,例如「講話再簡短一點」"
              kind="persona"
              items={personas}
              tripId={tripId}
              onChanged={load}
            />
            <MemorySection
              title="記憶"
              icon={<Brain weight="fill" className="size-4 text-ocean-deep" />}
              hint="要一直記得的事,例如「晚餐預算每人 ¥3,000」"
              kind="memory"
              items={memories}
              tripId={tripId}
              onChanged={load}
            />
          </div>
        )}
      </aside>
    </div>
  );
}

function MemorySection({
  title,
  icon,
  hint,
  kind,
  items,
  tripId,
  onChanged,
}: {
  title: string;
  icon: React.ReactNode;
  hint: string;
  kind: "memory" | "persona";
  items: AgentMemory[];
  tripId: string;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const add = async () => {
    if (!draft.trim()) return;
    await apiFetch(`/api/trips/${tripId}/agent/memories`, {
      json: { kind, content: draft.trim() },
    });
    setDraft("");
    onChanged();
  };
  const save = async (id: string) => {
    if (!editText.trim()) return;
    await apiFetch(`/api/agent/memories/${id}`, { method: "PATCH", json: { content: editText.trim() } });
    setEditingId(null);
    onChanged();
  };
  const remove = async (id: string) => {
    await apiFetch(`/api/agent/memories/${id}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        {icon}
        {title}
      </h3>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {items.length === 0 && <li className="text-[12px] text-ink-faint">{hint}</li>}
        {items.map((m) => (
          <li
            key={m.id}
            className="group flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-[13px] text-ink"
          >
            {editingId === m.id ? (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Input
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) save(m.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="!h-8 text-[13px]"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    取消
                  </Button>
                  <Button size="sm" onClick={() => save(m.id)}>
                    儲存
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <span className="min-w-0 flex-1 leading-relaxed break-words">{m.content}</span>
                <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    aria-label="編輯"
                    onClick={() => {
                      setEditingId(m.id);
                      setEditText(m.content);
                    }}
                    className="tm-focus rounded p-1 text-ink-faint hover:bg-surface hover:text-ink"
                  >
                    <PencilSimple className="size-3.5" />
                  </button>
                  <button
                    aria-label="刪除"
                    onClick={() => remove(m.id)}
                    className="tm-focus rounded p-1 text-ink-faint hover:bg-alert-wash hover:text-alert"
                  >
                    <Trash className="size-3.5" />
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) add();
          }}
          placeholder={`新增${title}…`}
          className="!h-8 min-w-0 flex-1 text-[13px]"
        />
        <button
          aria-label={`新增${title}`}
          onClick={add}
          disabled={!draft.trim()}
          className={cn(
            "tm-focus flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
            draft.trim()
              ? "bg-ocean text-white hover:bg-ocean-deep"
              : "bg-sunken text-ink-faint",
          )}
        >
          <Plus weight="bold" className="size-4" />
        </button>
      </div>
    </section>
  );
}
