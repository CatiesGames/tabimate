"use client";

// 旅遊設定:名稱/地點/起訖日期/天數 統一在這裡改(取代「加一天」按鈕)。
// 天數縮短=從結尾移除天(連同行程,存檔前有警示;可從版本歷史還原);
// 全部變更走 changeset(update_trip/add_day/remove_day)→ 進版本歷史,塔比下一輪會被告知。
import { useEffect, useState } from "react";
import { Minus, Plus, Warning } from "@phosphor-icons/react";

import { addDaysISO, diffDaysISO } from "@/lib/dates";
import type { Operation } from "@/shared/changeset";
import { useTrip } from "@/lib/workspace/WorkspaceProvider";
import { Button, DateField, Dialog, Field, Input } from "@/components/ui";

const MAX_DAYS = 60;

export function TripSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { doc, editOps } = useTrip();
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dayCount, setDayCount] = useState(1);

  const days = doc ? [...doc.days].sort((a, b) => a.position - b.position) : [];
  useEffect(() => {
    if (open && doc) {
      setTitle(doc.trip.title);
      setDestination(doc.trip.destination ?? "");
      setStartDate(doc.trip.startDate);
      setDayCount(doc.days.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!doc) return null;

  const endDate = startDate ? addDaysISO(startDate, dayCount - 1) : null;
  const removedDays = days.slice(dayCount);
  const removedStopCount = doc.stops.filter((s) =>
    removedDays.some((d) => d.id === s.dayId),
  ).length;
  const addedCount = Math.max(0, dayCount - days.length);

  const patch: { title?: string; destination?: string | null; startDate?: string | null } = {};
  if (title.trim() && title.trim() !== doc.trip.title) patch.title = title.trim();
  if ((destination.trim() || null) !== doc.trip.destination) {
    patch.destination = destination.trim() || null;
  }
  if (startDate !== doc.trip.startDate) patch.startDate = startDate;
  const dirty = Object.keys(patch).length > 0 || dayCount !== days.length;

  const save = () => {
    const ops: Operation[] = [];
    const parts: string[] = [];
    if (Object.keys(patch).length > 0) {
      ops.push({ op: "update_trip", patch });
      if (patch.title != null) parts.push("名稱");
      if ("destination" in patch) parts.push("地點");
      if ("startDate" in patch) parts.push("日期");
    }
    if (dayCount > days.length) {
      for (let i = 0; i < dayCount - days.length; i++) ops.push({ op: "add_day" });
      parts.push(`天數 ${days.length}→${dayCount}`);
    } else if (dayCount < days.length) {
      for (const d of removedDays) ops.push({ op: "remove_day", dayId: d.id });
      parts.push(`天數 ${days.length}→${dayCount}`);
    }
    editOps(ops, `調整旅遊設定(${parts.join("、")})`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="旅遊設定">
      <div className="flex flex-col gap-4">
        <Field label="旅遊名稱">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />
        </Field>
        <Field label="旅遊地點" hint="城市或地區,例如「東京」">
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            maxLength={40}
            placeholder="(未設定)"
          />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="出發日">
            <DateField value={startDate} onChange={setStartDate} clearable />
          </Field>
          <Field label="最後一天">
            {startDate ? (
              <DateField
                value={endDate}
                min={startDate}
                onChange={(v) => {
                  if (v) setDayCount(Math.min(MAX_DAYS, diffDaysISO(startDate, v) + 1));
                }}
              />
            ) : (
              <span className="flex h-9 items-center text-[13px] text-ink-faint">
                設定出發日後自動換算
              </span>
            )}
          </Field>
        </div>
        <Field label="天數">
          <div className="flex items-center gap-2">
            <button
              aria-label="減一天"
              disabled={dayCount <= 1}
              onClick={() => setDayCount((n) => Math.max(1, n - 1))}
              className="tm-focus flex size-9 items-center justify-center rounded-md border border-line text-ink-soft transition-colors hover:bg-sunken disabled:opacity-40"
            >
              <Minus weight="bold" className="size-4" />
            </button>
            <span className="tm-num w-14 text-center text-base font-semibold text-ink">
              {dayCount} 天
            </span>
            <button
              aria-label="加一天"
              disabled={dayCount >= MAX_DAYS}
              onClick={() => setDayCount((n) => Math.min(MAX_DAYS, n + 1))}
              className="tm-focus flex size-9 items-center justify-center rounded-md border border-line text-ink-soft transition-colors hover:bg-sunken disabled:opacity-40"
            >
              <Plus weight="bold" className="size-4" />
            </button>
          </div>
        </Field>

        {removedDays.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-alert-wash px-3 py-2.5 text-[13px] leading-relaxed text-alert">
            <Warning weight="fill" className="mt-0.5 size-4 shrink-0" />
            <span>
              將移除 Day {days.length - removedDays.length + 1}
              {removedDays.length > 1 && ` ~ Day ${days.length}`}
              {removedStopCount > 0 && `(內含 ${removedStopCount} 個地點)`}
              。儲存後隨時可從版本歷史還原。
            </span>
          </p>
        )}
        {addedCount > 0 && (
          <p className="rounded-lg bg-ocean-wash px-3 py-2.5 text-[13px] text-ocean-deep">
            將在結尾新增 {addedCount} 天。
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!dirty || !title.trim()} onClick={save}>
            儲存
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
