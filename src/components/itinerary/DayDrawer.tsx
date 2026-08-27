"use client";

import { Warning, X } from "@phosphor-icons/react";

import { detectTimeConflicts } from "@/shared/conflicts";
import { cn } from "@/lib/cn";
import { dayDateLabel } from "@/lib/dates";
import {
  usePresence,
  useSelection,
  useTrip,
} from "@/lib/workspace/WorkspaceProvider";
import { AvatarStack } from "@/components/ui";

/** 手機版:左側天數抽屜(頂欄放不下 tabs 時的切換入口;旅遊設定在右上「更多動作」選單)。 */
export function DayDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { doc } = useTrip();
  const { activeDayId, setActiveDay } = useSelection();
  const { viewersOfDay } = usePresence();

  if (!open || !doc) return null;
  const days = [...doc.days].sort((a, b) => a.position - b.position);
  const conflicts = detectTimeConflicts(doc.days, doc.stops);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="tm-pop-in tm-scroll absolute top-0 left-0 flex h-full w-[280px] max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <h2 className="font-display text-base font-semibold text-ink">切換天數</h2>
          <button
            aria-label="關閉"
            onClick={onClose}
            className="tm-focus rounded-sm p-1 text-ink-faint hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        <ol className="flex flex-col gap-1 p-3">
          {days.map((day, i) => {
            const active = day.id === activeDayId;
            const dateLabel = dayDateLabel(doc.trip.startDate, day.position);
            const dayStops = doc.stops.filter((s) => s.dayId === day.id);
            const unbooked = dayStops.some(
              (s) =>
                (s.bookingType === "reservation_required" ||
                  s.bookingType === "ticket_required") &&
                s.bookingStatus === "not_booked",
            );
            const conflicted = dayStops.some((s) => conflicts.has(s.id));
            const viewers = viewersOfDay(day.id);
            return (
              <li key={day.id}>
                <button
                  onClick={() => {
                    setActiveDay(day.id);
                    onClose();
                  }}
                  className={cn(
                    "tm-focus flex w-full items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                    active
                      ? "border-coral bg-coral-wash"
                      : "border-transparent hover:bg-sunken",
                  )}
                >
                  <span
                    className={cn(
                      "font-display text-sm font-bold",
                      active ? "text-coral-deep" : "text-ink",
                    )}
                  >
                    Day {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    {dateLabel && (
                      <span className="tm-num block text-xs text-ink-soft">{dateLabel}</span>
                    )}
                    <span className="block text-[11px] text-ink-faint">
                      {dayStops.length} 個地點
                    </span>
                  </span>
                  {viewers.length > 0 && <AvatarStack users={viewers} size="xs" max={3} />}
                  {(unbooked || conflicted) && (
                    <Warning weight="fill" className="size-4 shrink-0 text-alert" />
                  )}
                </button>
              </li>
            );
          })}
        </ol>

      </aside>
    </div>
  );
}
