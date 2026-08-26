"use client";

import { useEffect, useRef, useState } from "react";
import { Bed, CaretRight, DotsSixVertical, Plus, Warning } from "@phosphor-icons/react";

import { CATEGORY_META, LEG_MODE_ICON } from "@/lib/categories";
import { cn } from "@/lib/cn";
import {
  carryOverLodging,
  detectTimeConflicts,
  isOvernightLodging,
  primaryLodgingOf,
} from "@/shared/conflicts";
import type { CarryLeg, Day, Leg, Stop } from "@/shared/types";
import {
  type CarryEdge,
  carryLegSaveOp,
  carryLegSelectionId,
  resolveCarryLeg,
} from "@/lib/carryLeg";
import {
  usePresence,
  useSelection,
  useSession,
  useTrip,
} from "@/lib/workspace/WorkspaceProvider";
import { AvatarStack, Hint, Tag } from "@/components/ui";
import { BookingBadge, VerifyBadge } from "./badges";
import { LegEditor } from "./LegEditor";
import { TimeField } from "./TimeField";
import { StopThumb } from "./StopThumb";
import { AddStop } from "./AddStop";

const CONFLICT_TIP =
  "時間與前後行程順序衝突\n調整時間,或直接拖曳卡片重新排序\n(也可以請塔比整理)";

export function Timeline() {
  const { doc, changedStopIds, editOps } = useTrip();
  const { activeDayId, selectedStopId, setSelectedStop, selectedLegId, setSelectedLeg } = useSelection();
  const { viewersOfStop } = usePresence();
  const { memberOf } = useSession();

  const listRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  // 選取變更 → 把時間軸上的該項目捲進視野(nearest:已可見就不動);
  // tm-show-timeline(聊天提及跳轉)→ 行程頁顯示後置中定位
  const scrollToSelection = (behavior: ScrollBehavior, block: ScrollLogicalPosition) => {
    const sel = selectedLegId
      ? `[data-sel-leg="${CSS.escape(selectedLegId)}"]`
      : selectedStopId
        ? `[data-sel-stop="${CSS.escape(selectedStopId)}"]`
        : null;
    if (!sel) return;
    listRef.current?.querySelector(sel)?.scrollIntoView({ behavior, block });
  };
  useEffect(() => {
    scrollToSelection("smooth", "nearest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStopId, selectedLegId]);
  useEffect(() => {
    const fn = () => setTimeout(() => scrollToSelection("auto", "center"), 150);
    window.addEventListener("tm-show-timeline", fn);
    return () => window.removeEventListener("tm-show-timeline", fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStopId, selectedLegId, activeDayId]);
  const [dragging, setDragging] = useState<{
    stopId: string;
    fromIndex: number;
    overIndex: number;
    y: number;
    /** 被拖區塊(卡片+其交通段)的高度,其他區塊讓位時滑動這個距離。 */
    wrapH: number;
  } | null>(null);

  if (!doc || !activeDayId) return null;
  const stops = doc.stops
    .filter((s) => s.dayId === activeDayId)
    .sort((a, b) => a.position - b.position);
  const legOf = (stopId: string): Leg | undefined =>
    doc.legs.find((l) => l.fromStopId === stopId);
  const conflicts = detectTimeConflicts(doc.days, doc.stops);

  // ---- 拖曳重排:整張卡可拖(滑鼠移動 >6px 才啟動,不干擾點選);手把按下即拖(含觸控)。 ----
  const beginDrag = (
    startEvent: { clientY: number },
    stop: Stop,
    index: number,
    immediate: boolean,
  ) => {
    const startY = startEvent.clientY;
    let started = immediate;
    // 啟動當下快照各區塊位置(拖曳期間有 transform,不能量即時 rect)
    let mids: number[] = [];
    let wrapH = 0;
    const snapshot = () => {
      const els = [
        ...(listRef.current?.querySelectorAll("[data-stop-wrap]") ?? []),
      ] as HTMLElement[];
      const rects = els.map((el) => el.getBoundingClientRect());
      mids = rects.map((r) => r.top + r.height / 2);
      wrapH = rects[index]?.height ?? 0;
    };
    if (immediate) {
      snapshot();
      setDragging({ stopId: stop.id, fromIndex: index, overIndex: index, y: 0, wrapH });
      document.body.style.userSelect = "none";
    }

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!started) {
        if (Math.abs(dy) < 6) return;
        started = true;
        suppressClick.current = true;
        snapshot();
        setDragging({ stopId: stop.id, fromIndex: index, overIndex: index, y: 0, wrapH });
        document.body.style.userSelect = "none";
      }
      // over = 游標所在落點:高於全部中點 → 0;否則最後一個中點在游標上方的 i
      let over = 0;
      for (let i = 0; i < mids.length; i++) {
        if (ev.clientY > mids[i]) over = i;
      }
      setDragging((d) => (d ? { ...d, y: dy, overIndex: over } : d));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      setDragging((d) => {
        if (d && started && d.overIndex !== d.fromIndex) {
          editOps(
            [{ op: "move_stop", stopId: d.stopId, toDayId: activeDayId, position: d.overIndex }],
            `調整 ${stop.name} 順序`,
          );
        }
        return null;
      });
      // 拖過之後吞掉隨後的 click,避免誤觸選取
      setTimeout(() => {
        suppressClick.current = false;
      }, 50);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const carryLodging = carryOverLodging(doc.days, doc.stops, activeDayId);
  const activeDay = doc.days.find((d) => d.id === activeDayId) ?? null;
  // 統一間隙列:每個地點/交通之間都是「+安排交通 +新增地點」;點新增就地展開插入
  const renderGap = (gapKey: string, insertPos: number | undefined, legTrigger: React.ReactNode) => (
    <div key={gapKey} className="flex py-1 pl-[1.35rem]">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 border-l-2 border-dotted border-line-strong py-0.5 pl-4">
        {legTrigger}
        <AddStop dayId={activeDayId} position={insertPos} />
      </div>
    </div>
  );
  const transitPill = (stop2: Stop, next2: Stop, leg2: Leg | null) => (
    <LegEditor stop={stop2} nextStop={next2} leg={leg2}>
      <button className="tm-focus flex shrink-0 items-center gap-1 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-xs text-ink-soft transition-[color,border-color,background-color] hover:border-ocean hover:bg-ocean-wash hover:text-ocean-deep">
        <Plus weight="bold" className="size-3.5" />
        安排交通
      </button>
    </LegEditor>
  );

  // 住宿頭尾交通(存在 day 上)也走統一間隙模式:pills → 交通卡 → pills。
  // 卡片點了與一般交通一致 → 開底部詳細卡;pill(尚未安排/快速調整)維持就地 popover。
  const carryLegZone = (edge: "top" | "bottom", day: Day) => {
    const carryEdge: CarryEdge = edge === "top" ? "morning" : "evening";
    const isTop = edge === "top";
    const keyBase = isTop ? "head" : "tail";
    const insertPos = isTop ? 0 : undefined;
    const ctx = resolveCarryLeg(doc, day.id, carryEdge);
    if (!ctx) return renderGap(keyBase, insertPos, null);
    const selId = carryLegSelectionId(day.id, carryEdge);
    const saveLeg = (p: CarryLeg | null) => {
      const { ops, label } = carryLegSaveOp(ctx, carryEdge, p);
      editOps(ops, label);
    };
    const pill = (
      <LegEditor
        stop={ctx.from}
        nextStop={ctx.to}
        leg={ctx.fakeLeg}
        saveOverride={saveLeg}
        removeOverride={() => saveLeg(null)}
      >
        <button className="tm-focus flex shrink-0 items-center gap-1 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-xs text-ink-soft transition-[color,border-color,background-color] hover:border-ocean hover:bg-ocean-wash hover:text-ocean-deep">
          <Plus weight="bold" className="size-3.5" />
          安排交通
        </button>
      </LegEditor>
    );
    if (!ctx.fakeLeg) return renderGap(keyBase, insertPos, pill);
    return (
      <>
        {renderGap(`${keyBase}-a`, insertPos, pill)}
        <div className="flex pl-[1.35rem]">
          <div className="flex min-w-0 flex-1 items-center border-l-2 border-dotted border-line-strong py-0.5 pl-4">
            <button
              data-sel-leg={selId}
              onClick={() => setSelectedLeg(selectedLegId === selId ? null : selId)}
              className={cn(
                "tm-focus flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-surface px-3 py-2 text-left text-xs text-ink-soft shadow-card transition-[border-color,box-shadow] hover:border-ocean/40 hover:shadow-lift",
                selectedLegId === selId ? "border-ocean/60 shadow-lift" : "border-line",
              )}
            >
              <LegSummary leg={ctx.fakeLeg} />
            </button>
          </div>
        </div>
        {renderGap(`${keyBase}-b`, insertPos, pill)}
      </>
    );
  };

  // 住宿主卡(入住日第一張 lodging):主卡不在末位時,結尾自動出現「今晚回這裡住」錨列
  const primaryStop = primaryLodgingOf(doc.days, doc.stops, activeDayId);
  const checkinMidday =
    primaryStop && stops[stops.length - 1]?.id !== primaryStop.id ? primaryStop : null;

  return (
    <div ref={listRef} className="flex flex-col">
      {/* 續住列:固定在頭尾 — 早上從這出發(頭);中間天晚上回來續住(尾);退房日只有頭 */}
      {carryLodging && activeDay && (
        <>
          <CarryLodgingRow carry={carryLodging} edge="top" day={activeDay} />
          {carryLegZone("top", activeDay)}
        </>
      )}
      {stops.length === 0 && (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-faint">
          這天還沒有安排,從下方搜尋加入地點,或直接請右側的塔比規劃。
        </p>
      )}
      {stops.map((stop, i) => {
        const meta = CATEGORY_META[stop.category];
        const Icon = meta.icon;
        const selected = stop.id === selectedStopId;
        const conflicted = conflicts.has(stop.id);
        const viewers = viewersOfStop(stop.id);
        const isDragging = dragging?.stopId === stop.id;
        // 讓位:被拖區塊經過的其他區塊往反方向平滑滑動(常見拖曳排序效果)
        const shift =
          dragging && !isDragging
            ? dragging.fromIndex < i && i <= dragging.overIndex
              ? -dragging.wrapH
              : dragging.overIndex <= i && i < dragging.fromIndex
                ? dragging.wrapH
                : 0
            : 0;
        const leg = legOf(stop.id);
        const nextStop = stops[i + 1];

        return (
          <div key={stop.id}>
          <div
            data-stop-wrap
            data-sel-stop={stop.id}
            style={
              dragging
                ? isDragging
                  ? { transform: `translateY(${dragging.y}px)`, position: "relative", zIndex: 10 }
                  : { transform: shift ? `translateY(${shift}px)` : undefined, transition: "transform 160ms ease" }
                : undefined
            }
          >
            <div
              data-stop-card
              onPointerDown={(e) => {
                // 滑鼠在卡片空白處按住拖曳;按鈕/圖片/觸控交給手把
                if (e.pointerType !== "mouse" || e.button !== 0) return;
                if ((e.target as HTMLElement).closest("button, a, input, textarea, img")) return;
                beginDrag(e, stop, i, false);
              }}
              onClick={() => {
                if (suppressClick.current) return;
                setSelectedStop(selected ? null : stop.id);
              }}
              className={cn(
                "group relative flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition-[border-color,box-shadow,background-color] duration-150",
                selected
                  ? "border-coral/50 bg-surface shadow-lift"
                  : conflicted
                    ? "border-alert/45 bg-surface shadow-card"
                    : "border-transparent bg-surface shadow-card hover:border-line-strong",
                isDragging && "scale-[1.02] cursor-grabbing shadow-lift",
                changedStopIds.has(stop.id) && "tm-change-flash",
              )}
            >
              {viewers.length > 0 && (
                <span
                  className="pointer-events-none absolute inset-0 rounded-lg"
                  style={{ boxShadow: `0 0 0 2px ${viewers[0].color}` }}
                />
              )}
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <span className="relative">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: meta.colorVar }}
                    title={meta.label}
                  >
                    <Icon weight="fill" className="size-4" />
                  </span>
                  {/* 與地圖數字標記對應 */}
                  <span className="tm-num absolute -top-1 -left-1 flex size-4 items-center justify-center rounded-full border border-line bg-surface text-[10px] leading-none font-bold text-ink">
                    {i + 1}
                  </span>
                </span>
                <button
                  aria-label="拖曳排序"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    beginDrag(e, stop, i, true);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="cursor-grab touch-none rounded p-0.5 text-ink-faint opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
                >
                  <DotsSixVertical weight="bold" className="size-4" />
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  {stop.startTime && (
                    <span
                      className={cn(
                        "tm-num flex shrink-0 items-center gap-1 text-[13px] font-semibold",
                        conflicted ? "text-alert" : "text-ink",
                      )}
                    >
                      {conflicted && (
                        <Hint tip={CONFLICT_TIP}>
                          <Warning weight="fill" className="size-3.5 text-alert" />
                        </Hint>
                      )}
                      {stop.startTime}
                      {stop.id === primaryStop?.id ? (
                        <span className="text-[11px] font-normal text-ink-faint">
                          入住{isOvernightLodging(stop) && ` · 退房 ${stop.endTime}`}
                        </span>
                      ) : stop.category === "lodging" ? (
                        <span className={conflicted ? "text-alert/70" : "text-ink-faint"}>
                          {" "}
                          - {stop.endTime}
                          <span className="ml-1 text-[11px] font-normal">休息</span>
                        </span>
                      ) : (
                        stop.endTime && (
                          <span className={conflicted ? "text-alert/70" : "text-ink-faint"}>
                            {" "}
                            - {stop.endTime}
                          </span>
                        )
                      )}
                    </span>
                  )}
                  <span className="truncate text-sm font-medium text-ink">{stop.name}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <BookingBadge stop={stop} />
                  <VerifyBadge stop={stop} />
                  {viewers.length > 0 && <AvatarStack users={viewers} size="xs" max={2} />}
                </div>
                {stop.notes && (
                  <p className="mt-1 line-clamp-1 text-xs text-ink-soft">{stop.notes}</p>
                )}
                {stop.updatedByUserId && (
                  <p className="mt-0.5 text-[10px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100">
                    {memberOf(stop.updatedByUserId).name} 編輯
                  </p>
                )}
              </div>

              <StopThumb stop={stop} className="size-14 shrink-0" />
            </div>

            {/* 間隙:地點-交通-地點 之間都有 +安排交通 +新增地點 */}
            {nextStop && leg && (
              <>
                {renderGap(`g${i}-a`, i + 1, transitPill(stop, nextStop, leg))}
                <div className="flex pl-[1.35rem]">
                  <div className="flex min-w-0 flex-1 items-center border-l-2 border-dotted border-line-strong py-0.5 pl-4">
                    <button
                      data-sel-leg={stop.id}
                      onClick={() => setSelectedLeg(selectedLegId === stop.id ? null : stop.id)}
                      className={cn(
                        "tm-focus flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-left text-xs shadow-card transition-[border-color,box-shadow] hover:shadow-lift",
                        leg.needsReview
                          ? "border-sun/60 bg-sun-wash text-sun-deep hover:border-sun"
                          : "border-line bg-surface text-ink-soft hover:border-ocean/40",
                        selectedLegId === stop.id && "border-ocean/60 shadow-lift",
                      )}
                    >
                      {leg.needsReview && (
                        <Hint tip={"相鄰地點被移動或改了時間\n請重新確認這段交通(點開重新設定)"}>
                          <span className="flex items-center gap-1 font-medium">
                            <Warning weight="fill" className="size-3.5" />
                            需重新確認
                          </span>
                        </Hint>
                      )}
                      {leg.bookingType !== "none" && <BookingBadge stop={leg} />}
                      <LegSummary leg={leg} muted={leg.needsReview} />
                    </button>
                  </div>
                </div>
                {renderGap(`g${i}-b`, i + 1, transitPill(stop, nextStop, leg))}
              </>
            )}
            {nextStop && !leg && renderGap(`g${i}`, i + 1, transitPill(stop, nextStop, null))}
          </div>
          </div>
        );
      })}

      {/* 一天的結尾是回住宿:續住中間天,或入住日先放了行李(住宿不在末位) */}
      {(() => {
        const bottomCarry =
          carryLodging && !carryLodging.isCheckoutDay
            ? carryLodging
            : checkinMidday
              ? { stop: checkinMidday, isCheckoutDay: false }
              : null;
        if (!activeDay || !bottomCarry) return renderGap("end", undefined, null);
        return (
          <>
            {carryLegZone("bottom", activeDay)}
            <CarryLodgingRow carry={bottomCarry} edge="bottom" day={activeDay} />
          </>
        );
      })()}
    </div>
  );
}

/**
 * 續住錨點列(虛擬列,資料仍在原住宿上):
 * top=「昨晚住這」+ 離開時間 + 住宿→首行程交通;bottom=「今晚回這裡續住」+ 回到時間 + 末行程→住宿交通。
 * 時間與交通存在 day 上(lodgingDepartTime/ReturnTime/MorningLeg/EveningLeg)。
 */
function CarryLodgingRow({
  carry,
  edge,
  day,
}: {
  carry: NonNullable<ReturnType<typeof carryOverLodging>>;
  edge: "top" | "bottom";
  day: Day;
}) {
  const { editOps } = useTrip();
  const { setSelectedStop } = useSelection();
  const isTop = edge === "top";
  const label = !isTop ? "今晚回這裡住" : carry.isCheckoutDay ? "昨晚住這,今天退房" : "昨晚住這";
  // 早上離開住宿的時間:中間天存 day.lodgingDepartTime;退房日就是住宿的退房時間
  const departValue = carry.isCheckoutDay
    ? isOvernightLodging(carry.stop)
      ? carry.stop.endTime
      : null
    : day.lodgingDepartTime;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 overflow-hidden rounded-lg border border-dashed border-cat-lodging/45 bg-cat-lodging/5 px-2.5 py-2 whitespace-nowrap",
          isTop ? "mb-1.5" : "mt-2",
        )}
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: "var(--tm-cat-lodging)" }}
        >
          <Bed weight="fill" className="size-3.5" />
        </span>
        <button
          onClick={() => setSelectedStop(carry.stop.id)}
          className="tm-focus min-w-0 flex-1 truncate text-left"
          title="查看住宿詳情"
        >
          <span className="truncate text-sm font-medium text-ink">{carry.stop.name}</span>
          <span className="block text-[11px] text-ink-soft">{label}</span>
        </button>
        {isTop && carry.isCheckoutDay && (
          <Hint tip={"退房/出發時間(記錄在住宿的結束時間)\n今天第一個行程早於這個時間會出現警示"}>
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-soft">
              退房
              <TimeField
                value={departValue}
                onChange={(v) =>
                  editOps(
                    [{ op: "update_stop", stopId: carry.stop.id, patch: { endTime: v } }],
                    `設定 ${carry.stop.name} 退房時間`,
                  )
                }
                placeholder="--:--"
              />
            </span>
          </Hint>
        )}
        {isTop && !carry.isCheckoutDay && (
          <Hint tip={"今天早上幾點離開住宿\n第一個行程早於這個時間會出現警示"}>
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-soft">
              出發
              <TimeField
                value={departValue}
                onChange={(v) =>
                  editOps(
                    [{ op: "update_day", dayId: day.id, patch: { lodgingDepartTime: v } }],
                    `設定離開 ${carry.stop.name} 時間`,
                  )
                }
                placeholder="--:--"
              />
            </span>
          </Hint>
        )}
        {!isTop && (
          <Hint tip={"今晚幾點回到住宿\n最後一個行程結束得比這晚會出現警示"}>
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-soft">
              回到
              <TimeField
                value={day.lodgingReturnTime}
                onChange={(v) =>
                  editOps(
                    [{ op: "update_day", dayId: day.id, patch: { lodgingReturnTime: v } }],
                    `設定回 ${carry.stop.name} 時間`,
                  )
                }
                placeholder="--:--"
              />
            </span>
          </Hint>
        )}
        <StopThumb stop={carry.stop} className="size-10 shrink-0" />
      </div>
    </>
  );
}

/** 交通段內容:多段(轉車)時逐段呈現,單段時精簡一行。 */
function LegSummary({ leg, muted }: { leg: Leg; muted?: boolean }) {
  const steps = leg.transit?.steps?.filter((s) => s.line || s.departureTime) ?? [];
  const LegIcon = LEG_MODE_ICON[leg.mode];

  if (steps.length > 0) {
    return (
      <>
        {steps.map((step, i) => {
          const StepIcon =
            LEG_MODE_ICON[(step.mode as keyof typeof LEG_MODE_ICON) ?? "transit"] ??
            LEG_MODE_ICON.transit;
          return (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <CaretRight className="size-3 shrink-0 opacity-50" />}
              <span
                className={cn(
                  "flex size-4.5 shrink-0 items-center justify-center rounded-full text-white",
                  muted ? "bg-sun-deep/70" : "bg-ocean",
                )}
              >
                <StepIcon weight="fill" className="size-2.5" />
              </span>
              {step.line && <span className="max-w-32 truncate font-medium">{step.line}</span>}
              {step.departureTime && step.arrivalTime && (
                <span className="tm-num shrink-0 opacity-80">
                  {step.departureTime}→{step.arrivalTime}
                </span>
              )}
            </span>
          );
        })}
        {leg.durationMin != null && (
          <span className="tm-num shrink-0 font-medium">共 {leg.durationMin} 分</span>
        )}
        {leg.transit?.fare && <span className="tm-num shrink-0">{leg.transit.fare}</span>}
      </>
    );
  }

  return (
    <>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full text-white",
          muted ? "bg-sun-deep/70" : "bg-ocean",
        )}
      >
        <LegIcon weight="fill" className="size-3" />
      </span>
      {leg.transit?.summary && (
        <span className="max-w-44 truncate font-medium">{leg.transit.summary}</span>
      )}
      {leg.departureTime && leg.arrivalTime && (
        <span className="tm-num">
          {leg.departureTime}→{leg.arrivalTime}
        </span>
      )}
      {leg.durationMin != null && <span className="tm-num">{leg.durationMin} 分</span>}
      {leg.transit?.fare && <span className="tm-num">{leg.transit.fare}</span>}
      {leg.notes && <span className="max-w-28 truncate opacity-80">·{leg.notes}</span>}
    </>
  );
}


