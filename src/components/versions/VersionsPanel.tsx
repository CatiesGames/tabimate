"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUUpLeft, X } from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { clockLabel, timeAgo } from "@/lib/dates";
import type { VersionMeta } from "@/shared/types";
import { useRealtime, useSession, useTrip } from "@/lib/workspace/WorkspaceProvider";
import { Avatar, ConfirmDialog, Skeleton, Tag, toast } from "@/components/ui";

export function VersionsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tripId, memberOf } = useSession();
  const { doc } = useTrip();
  useRealtime();
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<VersionMeta | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ versions: VersionMeta[] }>(`/api/trips/${tripId}/versions`)
      .then((d) => setVersions(d.versions))
      .catch(() => setVersions([]));
  }, [tripId]);

  useEffect(() => {
    if (open) {
      setVersions(null);
      load();
    }
  }, [open, load]);

  // 行程變動時刷新列表
  const rev = doc?.trip.itineraryRev;
  useEffect(() => {
    if (open) load();
  }, [rev, open, load]);

  const rollback = async (v: VersionMeta) => {
    setBusy(true);
    try {
      await apiFetch(`/api/trips/${tripId}/versions/${v.id}/rollback`, { json: {} });
      toast(`已還原到版本 ${v.rev}`, { tone: "success" });
      setRollbackTarget(null);
    } catch {
      toast("還原失敗", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="tm-pop-in tm-scroll absolute top-0 right-0 flex h-full w-[380px] max-w-[92vw] flex-col overflow-y-auto border-l border-line bg-surface shadow-pop">
        <header className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <h2 className="font-display text-base font-semibold text-ink">版本歷史</h2>
          <button
            aria-label="關閉"
            onClick={onClose}
            className="tm-focus rounded-sm p-1 text-ink-faint hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        <ol className="flex flex-col gap-1 p-3">
          {versions === null &&
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          {versions?.length === 0 && (
            <p className="py-8 text-center text-[13px] text-ink-faint">還沒有任何變更。</p>
          )}
          {versions?.map((v, i) => {
            const actor = memberOf(v.actorUserId);
            const isCurrent = i === 0;
            return (
              <li
                key={v.id}
                className={cn(
                  "group rounded-lg border p-3 transition-colors",
                  isCurrent ? "border-coral/40 bg-coral-wash/40" : "border-transparent hover:bg-sunken",
                )}
              >
                <div className="flex items-center gap-2">
                  <Avatar user={actor} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {v.summary}
                  </span>
                  {isCurrent && <Tag tone="coral">目前</Tag>}
                </div>
                <div className="mt-1.5 flex items-center justify-between pl-7">
                  <p className="text-[11px] text-ink-faint">
                    v{v.rev} · {actor.name}
                    {v.agentInvolved && " · AI 參與"}
                    {v.changeKind === "rollback" && " · 還原"}
                    {" · "}
                    <span className="tm-num" title={clockLabel(v.createdAt)}>
                      {timeAgo(v.createdAt)}
                    </span>
                  </p>
                  {!isCurrent && (
                    <button
                      onClick={() => setRollbackTarget(v)}
                      className="tm-focus flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-ink-faint opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 hover:bg-coral-wash hover:text-coral-deep"
                    >
                      <ArrowUUpLeft className="size-3" />
                      還原
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </aside>

      <ConfirmDialog
        open={rollbackTarget !== null}
        onOpenChange={(o) => !o && setRollbackTarget(null)}
        title={`還原到版本 ${rollbackTarget?.rev}?`}
        description={
          <>
            行程會回到「{rollbackTarget?.summary}」之後的狀態。
            <br />
            這個動作本身也會成為一個新版本,隨時可以再還原回來。
          </>
        }
        confirmLabel="還原"
        loading={busy}
        onConfirm={() => rollbackTarget && rollback(rollbackTarget)}
      />
    </div>
  );
}
