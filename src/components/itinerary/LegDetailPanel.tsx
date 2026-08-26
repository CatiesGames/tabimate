"use client";

// 交通詳細卡:與地點詳細卡同一種呈現(桌面在地圖下方、手機在底部抽屜)。
// 點時間軸交通卡 / 聊天 @ 提及的交通就開這張;編輯入口在卡內(LegEditor)。
import { useState } from "react";
import { ArrowSquareOut, MapTrifold, PencilSimple, Trash, Warning, X } from "@phosphor-icons/react";

import { LEG_MODE_ICON, LEG_MODE_LABEL } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { useSelection, useTrip } from "@/lib/workspace/WorkspaceProvider";
import { carryLegSaveOp, parseCarryLegSelection, resolveCarryLeg } from "@/lib/carryLeg";
import type { CarryLeg } from "@/shared/types";
import { ConfirmDialog, SegmentedChips, Tag } from "@/components/ui";
import { BookingBadge, bookingWords } from "./badges";
import { LegEditor } from "./LegEditor";

export function LegDetailPanel({ onShowMap }: { onShowMap?: () => void }) {
  const { doc, editOps } = useTrip();
  const { selectedLegId, setSelectedLeg } = useSelection();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 住宿頭尾交通(存在 day 上)與一般交通(legs 表)共用這張卡
  const carrySel = selectedLegId ? parseCarryLegSelection(selectedLegId) : null;
  const carryCtx = carrySel && doc ? resolveCarryLeg(doc, carrySel.dayId, carrySel.edge) : null;
  const leg = carrySel
    ? carryCtx?.fakeLeg
    : doc?.legs.find((l) => l.fromStopId === selectedLegId);
  const from = carrySel ? carryCtx?.from : doc?.stops.find((s) => s.id === leg?.fromStopId);
  const to = carrySel ? carryCtx?.to : doc?.stops.find((s) => s.id === leg?.toStopId);
  if (!doc || !leg || !from || !to) return null;
  const saveCarry =
    carrySel && carryCtx
      ? (p: CarryLeg | null) => {
          const { ops, label } = carryLegSaveOp(carryCtx, carrySel.edge, p);
          editOps(ops, label);
        }
      : null;

  const Icon = LEG_MODE_ICON[leg.mode];
  const steps = leg.transit?.steps?.filter((st) => st.line || st.departureTime) ?? [];
  const words = bookingWords(leg);

  return (
    <section className="tm-pop-in tm-scroll flex max-h-[46%] flex-col overflow-y-auto rounded-xl border border-line bg-surface shadow-lift max-md:max-h-[56dvh]">
      <div className="flex flex-col gap-3 p-4">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ocean text-white">
                <Icon weight="fill" className="size-3.5" />
              </span>
              <h2 className="truncate font-display text-lg font-semibold text-ink">
                {from.name} <span className="text-ink-faint">→</span> {to.name}
              </h2>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Tag tone="ocean">{LEG_MODE_LABEL[leg.mode]}</Tag>
              <BookingBadge stop={leg} size="md" />
              {leg.needsReview && (
                <Tag tone="sun">
                  <Warning weight="fill" className="size-3" />
                  需重新確認
                </Tag>
              )}
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1">
            {/* 手機抽屜:跳到地圖頁,涵蓋這段交通的起訖兩點(header 常駐,免捲動) */}
            {onShowMap && (from.lat != null || to.lat != null) && (
              <button
                onClick={onShowMap}
                className="tm-focus flex items-center gap-1 rounded-full bg-ocean-wash px-2.5 py-1 text-xs font-medium text-ocean-deep active:scale-[0.97]"
              >
                <MapTrifold weight="fill" className="size-3.5" />
                地圖
              </button>
            )}
            <button
              aria-label="關閉"
              onClick={() => setSelectedLeg(null)}
              className="tm-focus shrink-0 rounded-sm p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </span>
        </header>

        {/* 時間與費用 */}
        <p className="tm-num flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink">
          {leg.departureTime && (
            <span>
              {leg.departureTime}
              <span className="text-ink-faint"> → </span>
              {leg.arrivalTime ?? "?"}
            </span>
          )}
          {leg.durationMin != null && (
            <span className="rounded-full bg-ocean-wash px-2.5 py-0.5 text-xs font-medium text-ocean-deep">
              {leg.durationMin >= 60
                ? `${Math.floor(leg.durationMin / 60)} 時 ${leg.durationMin % 60} 分`
                : `${leg.durationMin} 分`}
            </span>
          )}
          {leg.transit?.fare && <span className="text-ink-soft">{leg.transit.fare}</span>}
        </p>

        {/* 路線 / 分段 */}
        {(leg.transit?.summary || steps.length > 0) && (
          <div className="rounded-lg bg-sunken p-3">
            {leg.transit?.summary && (
              <p className="text-[13px] font-medium text-ink">{leg.transit.summary}</p>
            )}
            {steps.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1">
                {steps.map((st, i) => {
                  const StIcon = LEG_MODE_ICON[(st.mode as keyof typeof LEG_MODE_ICON) ?? "transit"] ?? Icon;
                  return (
                    <li key={i} className="flex items-center gap-2 text-xs text-ink-soft">
                      <StIcon weight="fill" className="size-3.5 shrink-0 text-ocean" />
                      <span className="min-w-0 flex-1 truncate">{st.line ?? LEG_MODE_LABEL[(st.mode as keyof typeof LEG_MODE_LABEL) ?? "transit"]}</span>
                      {st.departureTime && st.arrivalTime && (
                        <span className="tm-num shrink-0">
                          {st.departureTime}→{st.arrivalTime}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* 購票 */}
        {leg.bookingType !== "none" && leg.bookingType !== "walk_in_queue" && (
          <div className="rounded-lg border border-sun/40 bg-sun-wash/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-sun-deep">
                {leg.bookingType === "ticket_required" ? "需要購票" : "建議預約"}
              </p>
              <SegmentedChips
                size="sm"
                options={[
                  { value: "not_booked" as const, label: words.todo },
                  { value: "booked" as const, label: `${words.done} ✓` },
                  { value: "unavailable" as const, label: words.fail },
                ]}
                value={leg.bookingStatus}
                onChange={(status) =>
                  editOps(
                    [{ op: "set_leg_booking", fromStopId: leg.fromStopId, bookingStatus: status }],
                    `${from.name} → ${to.name} 交通標記為${status === "booked" ? words.done : status === "unavailable" ? words.fail : words.todo}`,
                  )
                }
              />
            </div>
            {leg.booking?.note && (
              <p className="mt-1.5 text-xs text-ink-soft">{leg.booking.note}</p>
            )}
            {leg.booking?.url && (
              <a
                href={leg.booking.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-sun px-3 py-1.5 text-xs font-medium text-white transition-transform hover:brightness-105 active:scale-[0.97]"
              >
                <ArrowSquareOut weight="bold" className="size-3.5" />
                前往訂票
              </a>
            )}
          </div>
        )}

        {leg.notes && <p className="text-[13px] text-ink-soft">{leg.notes}</p>}

        <div className="flex items-center justify-between">
          <button
            onClick={() => setConfirmDelete(true)}
            className="tm-focus flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-alert-wash hover:text-alert"
          >
            <Trash className="size-3.5" />
            清除交通
          </button>
          <LegEditor
            stop={from}
            nextStop={to}
            leg={leg}
            saveOverride={saveCarry ?? undefined}
            removeOverride={saveCarry ? () => saveCarry(null) : undefined}
          >
            <button
              className={cn(
                "tm-focus flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                leg.needsReview
                  ? "bg-sun text-white hover:brightness-105"
                  : "bg-ocean-wash text-ocean-deep hover:bg-ocean hover:text-white",
              )}
            >
              <PencilSimple weight="fill" className="size-3.5" />
              {leg.needsReview ? "重新確認交通" : "編輯交通"}
            </button>
          </LegEditor>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`清除 ${from.name} → ${to.name} 的交通?`}
        description="清除後可以隨時重新安排,或從版本歷史還原。"
        confirmLabel="清除"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          setSelectedLeg(null);
          if (saveCarry) saveCarry(null);
          else
            editOps(
              [{ op: "remove_leg", fromStopId: leg.fromStopId }],
              `清除 ${from.name} → ${to.name} 交通`,
            );
        }}
      />
    </section>
  );
}
