"use client";

import { GearSix, Warning } from "@phosphor-icons/react";

import { detectTimeConflicts } from "@/shared/conflicts";
import { dayDateLabel } from "@/lib/dates";
import { cn } from "@/lib/cn";
import {
  usePresence,
  useSelection,
  useSession,
  useTrip,
} from "@/lib/workspace/WorkspaceProvider";
import { AvatarStack, Hint } from "@/components/ui";

export function DayTabs({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { doc } = useTrip();
  const { activeDayId, setActiveDay } = useSelection();
  const { viewersOfDay } = usePresence();
  useSession();

  if (!doc) return null;
  const days = [...doc.days].sort((a, b) => a.position - b.position);
  const conflicts = detectTimeConflicts(doc.days, doc.stops);

  return (
    <nav className="tm-scroll flex items-center gap-1.5 overflow-x-auto px-1 py-1">
      {days.map((day, i) => {
        const active = day.id === activeDayId;
        const viewers = viewersOfDay(day.id);
        const dateLabel = dayDateLabel(doc.trip.startDate, day.position);
        const dayStops = doc.stops.filter((s) => s.dayId === day.id);
        const dayStopIds = new Set(dayStops.map((s2) => s2.id));
        const needsBooking = (x: { bookingType: string; bookingStatus: string }) =>
          (x.bookingType === "reservation_required" || x.bookingType === "ticket_required") &&
          x.bookingStatus === "not_booked";
        const unbooked =
          dayStops.filter(needsBooking).length +
          doc.legs.filter((l) => dayStopIds.has(l.fromStopId) && needsBooking(l)).length;
        const conflicted = dayStops.filter((s) => conflicts.has(s.id)).length;
        const warnings: string[] = [];
        if (unbooked > 0) warnings.push(`${unbooked} 個必要預約/購票還沒完成`);
        if (conflicted > 0) warnings.push(`${conflicted} 個地點時間與順序衝突`);

        return (
          <button
            key={day.id}
            onClick={() => setActiveDay(day.id)}
            className={cn(
              "tm-focus relative flex shrink-0 select-none items-center gap-2 rounded-full border px-4 py-1.5 transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]",
              active
                ? "border-coral bg-coral text-white shadow-[0_2px_10px_-2px_rgb(255_93_71/0.55)]"
                : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
            )}
          >
            <span className="font-display text-sm font-semibold">Day {i + 1}</span>
            {dateLabel && (
              <span
                className={cn(
                  "tm-num text-xs",
                  active ? "text-white/85" : "text-ink-faint",
                )}
              >
                {dateLabel}
              </span>
            )}
            {viewers.length > 0 && (
              <AvatarStack users={viewers} size="xs" max={3} />
            )}
            {warnings.length > 0 && (
              <Hint
                tip={warnings.join("\n")}
                className="absolute -top-0.5 -right-0.5"
              >
                <span
                  className={cn(
                    "flex size-3.5 items-center justify-center rounded-full",
                    active ? "bg-white" : "bg-alert",
                  )}
                >
                  <Warning
                    weight="fill"
                    className={cn("size-2.5", active ? "text-alert" : "text-white")}
                  />
                </span>
              </Hint>
            )}
          </button>
        );
      })}
      {/* 名稱/地點/起訖日期/天數 統一在旅遊設定裡改 */}
      <button
        onClick={onOpenSettings}
        className="tm-focus flex shrink-0 select-none items-center gap-1 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-sm text-ink-faint transition-colors hover:border-coral hover:text-coral-deep active:scale-[0.97]"
      >
        <GearSix weight="bold" className="size-3.5" />
        旅遊設定
      </button>
    </nav>
  );
}
