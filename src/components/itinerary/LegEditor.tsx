"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Plus, Trash, X } from "@phosphor-icons/react";

import { LEG_MODE_ICON, LEG_MODE_LABEL } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { LEG_MODES, type LegMode } from "@/shared/config";
import type { CarryLeg, Leg, Stop, TransitDetail } from "@/shared/types";
import { useTrip } from "@/lib/workspace/WorkspaceProvider";
import { Button, Hint, Input, SegmentedChips } from "@/components/ui";
import { TimeField } from "./TimeField";

type Seg = { mode: LegMode; label: string; dep: string | null; arr: string | null };


const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** 交通段編輯 popover:單段(mode chips)或多段轉車(分段列表),時間齊全自動算時長。 */
export function LegEditor({
  stop,
  nextStop,
  leg,
  children,
  saveOverride,
  removeOverride,
}: {
  stop: Stop;
  nextStop: Stop;
  leg: Leg | null;
  children: React.ReactNode;
  /** 住宿頭尾交通(存在 day 上)用:覆寫儲存/清除,不走 set_leg。 */
  saveOverride?: (p: CarryLeg) => void;
  removeOverride?: () => void;
}) {
  const { editOps } = useTrip();
  const [open, setOpen] = useState(false);
  // 手機:向下展開(側向展開放不下 380px);桌機:從 chip 右側展開
  const [narrow, setNarrow] = useState(false);
  const [mode, setMode] = useState<LegMode>("walk");
  const [dep, setDep] = useState<string | null>(null);
  const [arr, setArr] = useState<string | null>(null);
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [segs, setSegs] = useState<Seg[]>([]);
  /** 路線名稱/說明(chip 上顯示的文字,如「東武晴空塔線 淺草→…」)— 與塔比寫入的同一欄位。 */
  const [summaryText, setSummaryText] = useState("");
  const [extras, setExtras] = useState<{ fare?: string; polyline?: string }>({});
  // 購票(新幹線/機場快線/指定席…):與地點預約同一套語意;住宿頭尾交通不支援
  const [bkType, setBkType] = useState<"none" | "ticket_required" | "recommended">("none");
  const [bkStatus, setBkStatus] = useState<"not_booked" | "booked" | "unavailable">("not_booked");
  const [bkUrl, setBkUrl] = useState("");

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      setNarrow(window.innerWidth < 768);
      setMode(leg?.mode ?? "walk");
      setDep(leg?.departureTime ?? null);
      setArr(leg?.arrivalTime ?? null);
      setDuration(leg?.durationMin?.toString() ?? "");
      setNotes(leg?.notes ?? "");
      setSummaryText(leg?.transit?.summary ?? "");
      setExtras({ fare: leg?.transit?.fare, polyline: leg?.transit?.polyline });
      setBkType(
        leg?.bookingType === "ticket_required" || leg?.bookingType === "recommended"
          ? leg.bookingType
          : leg?.bookingType && leg.bookingType !== "none"
            ? "ticket_required"
            : "none",
      );
      setBkStatus(leg?.bookingStatus ?? "not_booked");
      setBkUrl(leg?.booking?.url ?? "");
      setSegs(
        (leg?.transit?.steps ?? []).map((s) => ({
          mode: (LEG_MODES as readonly string[]).includes(s.mode as string)
            ? (s.mode as LegMode)
            : "transit",
          label: s.line ?? "",
          dep: s.departureTime ?? null,
          arr: s.arrivalTime ?? null,
        })),
      );
    }
  };

  // 分段模式:整段時間完全由分段推導(第一段出發 → 最後一段抵達),不再手填以免對不上
  const hasSegs = segs.length > 0;
  const segDep = segs.find((s) => s.dep)?.dep ?? null;
  const segArr = [...segs].reverse().find((s) => s.arr)?.arr ?? null;
  const effDep = hasSegs ? segDep : dep;
  const effArr = hasSegs ? segArr : arr;
  const autoDuration = (() => {
    if (!effDep || !effArr) return null;
    let diff = toMin(effArr) - toMin(effDep);
    if (diff < 0) diff += 24 * 60;
    return diff;
  })();

  const save = () => {
    const validSegs = segs.filter((s) => s.label.trim() || s.dep || s.arr);
    let transit: TransitDetail | null;
    let effMode = mode;
    if (validSegs.length > 0) {
      transit = {
        summary:
          summaryText.trim() ||
          validSegs.map((s) => s.label.trim() || LEG_MODE_LABEL[s.mode]).join(" → "),
        steps: validSegs.map((s) => ({
          mode: s.mode,
          line: s.label.trim() || undefined,
          departureTime: s.dep ?? undefined,
          arrivalTime: s.arr ?? undefined,
        })),
        fare: extras.fare,
        polyline: extras.polyline,
      };
      effMode = validSegs.find((s) => s.mode !== "walk")?.mode ?? validSegs[0].mode;
    } else if (summaryText.trim() || extras.fare || extras.polyline) {
      transit = {
        summary: summaryText.trim(),
        fare: extras.fare,
        polyline: extras.polyline,
      };
    } else {
      transit = null;
    }
    const payload: CarryLeg = {
      mode: effMode,
      durationMin: autoDuration ?? (duration ? Number(duration) : null),
      departureTime: effDep,
      arrivalTime: effArr,
      transit,
      notes,
    };
    if (saveOverride) {
      saveOverride(payload);
    } else {
      editOps(
        [
          {
            op: "set_leg",
            fromStopId: stop.id,
            ...payload,
            bookingType: bkType,
            bookingStatus: bkType === "none" ? "not_booked" : bkStatus,
            booking: bkUrl.trim() ? { ...(leg?.booking ?? {}), url: bkUrl.trim() } : (leg?.booking ?? null),
          },
        ],
        `調整 ${stop.name} → ${nextStop.name} 交通`,
      );
    }
    setOpen(false);
  };

  const remove = () => {
    if (removeOverride) removeOverride();
    else editOps([{ op: "remove_leg", fromStopId: stop.id }], `清除 ${stop.name} 出發交通`);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={narrow ? "bottom" : "right"}
          align={narrow ? "center" : "start"}
          sideOffset={8}
          collisionPadding={10}
          className="tm-pop-in tm-scroll z-30 max-h-[80vh] w-[min(380px,calc(100vw-20px))] overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-pop"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-3 text-[13px] font-medium text-ink">
            {stop.name} <span className="text-ink-faint">→</span> {nextStop.name}
            {leg?.needsReview && (
              <span className="ml-2 rounded-full bg-sun-wash px-2 py-0.5 text-[11px] text-sun-deep">
                需重新確認
              </span>
            )}
          </p>

          {segs.length === 0 && (
            <SegmentedChips
              size="sm"
              options={LEG_MODES.map((m) => {
                const Icon = LEG_MODE_ICON[m];
                return {
                  value: m,
                  label: LEG_MODE_LABEL[m],
                  icon: <Icon weight="fill" className="size-3.5" />,
                };
              })}
              value={mode}
              onChange={setMode}
            />
          )}

          {/* 路線名稱/說明(chip 上顯示;與塔比寫入的是同一個欄位) */}
          {segs.length === 0 && (
            <Input
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
              placeholder="路線名稱(如:東武晴空塔線 淺草→晴空塔)"
              className="mt-2 !h-8 text-[13px]"
            />
          )}

          {/* 分段(轉車) */}
          {segs.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {segs.map((seg, i) => (
                <div key={i} className="rounded-lg border border-line bg-sunken/40 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex gap-1">
                      {LEG_MODES.map((m) => {
                        const Icon = LEG_MODE_ICON[m];
                        const active = seg.mode === m;
                        return (
                          <Hint key={m} tip={LEG_MODE_LABEL[m]}>
                            <button
                              type="button"
                              onClick={() =>
                                setSegs((xs) => xs.map((x, j) => (j === i ? { ...x, mode: m } : x)))
                              }
                              className={cn(
                                "tm-focus flex size-7 items-center justify-center rounded-md transition-colors",
                                active
                                  ? "bg-ocean text-white"
                                  : "text-ink-faint hover:bg-sunken hover:text-ink",
                              )}
                            >
                              <Icon weight="fill" className="size-4" />
                            </button>
                          </Hint>
                        );
                      })}
                    </div>
                    <button
                      aria-label="移除此段"
                      onClick={() => setSegs((xs) => xs.filter((_, j) => j !== i))}
                      className="tm-focus rounded p-1 text-ink-faint hover:bg-alert-wash hover:text-alert"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Input
                      value={seg.label}
                      onChange={(e) =>
                        setSegs((xs) =>
                          xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                      placeholder={seg.mode === "walk" ? "步行(可留白)" : "如:JR山手線 澀谷→新宿"}
                      className="!h-8 min-w-0 flex-1 text-xs"
                    />
                    <TimeField
                      value={seg.dep}
                      onChange={(v) =>
                        setSegs((xs) => xs.map((x, j) => (j === i ? { ...x, dep: v } : x)))
                      }
                      placeholder="發"
                      defaultTime={i > 0 ? segs[i - 1].arr : (stop.endTime ?? stop.startTime)}
                      defaultLabel={i > 0 ? "接續前一段" : "接續前一項"}
                      className="!w-[4.2rem]"
                    />
                    <TimeField
                      value={seg.arr}
                      onChange={(v) =>
                        setSegs((xs) => xs.map((x, j) => (j === i ? { ...x, arr: v } : x)))
                      }
                      placeholder="到"
                      defaultTime={seg.dep ?? (i === segs.length - 1 ? nextStop.startTime : null)}
                      defaultLabel={seg.dep ? null : (i === segs.length - 1 ? "銜接後一項" : null)}
                      className="!w-[4.2rem]"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() =>
              setSegs((xs) => [
                ...xs,
                // 從單段模式切入分段時,把目前選的 mode 帶進第一段
                { mode: xs.length === 0 ? mode : "transit", label: "", dep: null, arr: null },
              ])
            }
            className="tm-focus mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ocean-deep transition-colors hover:bg-ocean-wash"
          >
            <Plus weight="bold" className="size-3" />
            {segs.length === 0 ? "分段設定(要轉車時用)" : "再加一段"}
          </button>

          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-ink-faint">整段</span>
            {hasSegs ? (
              <span className="tm-num rounded-md bg-sunken px-2.5 py-1.5 text-sm text-ink">
                {segDep ?? "--:--"} <span className="text-ink-faint">→</span> {segArr ?? "--:--"}
              </span>
            ) : (
              <>
                <TimeField
                  value={effDep}
                  onChange={setDep}
                  placeholder="出發"
                  defaultTime={stop.endTime ?? stop.startTime}
                />
                <span className="text-ink-faint">→</span>
                <TimeField
                  value={effArr}
                  onChange={setArr}
                  placeholder="抵達"
                  defaultTime={nextStop.startTime ?? effDep}
                  defaultLabel={nextStop.startTime ? "銜接後一項" : "接續前一項"}
                />
              </>
            )}
            {autoDuration != null ? (
              <span className="tm-num rounded-full bg-ocean-wash px-2.5 py-1 text-xs font-medium text-ocean-deep">
                {autoDuration >= 60
                  ? `${Math.floor(autoDuration / 60)} 時 ${autoDuration % 60} 分`
                  : `${autoDuration} 分`}
              </span>
            ) : (
              <>
                <Input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  placeholder="分"
                  className="!h-8 w-14 text-center text-sm"
                />
                <span className="text-xs text-ink-faint">分</span>
              </>
            )}
          </div>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="備註(如:搭到尾班車、IC 卡)"
            className="mt-2 !h-8 text-[13px]"
          />

          {/* 購票:新幹線/機場快線/指定席等要先買票的交通 */}
          {!saveOverride && (
            <div className="mt-2.5 rounded-lg bg-sunken/50 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-faint">購票</span>
                <SegmentedChips
                  size="sm"
                  options={[
                    { value: "none" as const, label: "免購票" },
                    { value: "ticket_required" as const, label: "需購票" },
                    { value: "recommended" as const, label: "建議預約" },
                  ]}
                  value={bkType}
                  onChange={setBkType}
                />
              </div>
              {bkType !== "none" && (
                <>
                  <div className="mt-1.5">
                    <SegmentedChips
                      size="sm"
                      options={[
                        { value: "not_booked" as const, label: "未購票" },
                        { value: "booked" as const, label: "已購票 ✓" },
                        { value: "unavailable" as const, label: "買不到" },
                      ]}
                      value={bkStatus}
                      onChange={setBkStatus}
                    />
                  </div>
                  <Input
                    value={bkUrl}
                    onChange={(e) => setBkUrl(e.target.value)}
                    placeholder="訂票連結(選填)"
                    className="mt-1.5 !h-8 text-[13px]"
                  />
                </>
              )}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between">
            {leg ? (
              <button
                onClick={remove}
                className="tm-focus flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-alert-wash hover:text-alert"
              >
                <Trash className="size-3.5" />
                清除
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={save}>
                {leg?.needsReview ? "確認交通" : "儲存"}
              </Button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
