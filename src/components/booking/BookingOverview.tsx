"use client";

import { ArrowSquareOut, Ticket, X } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import type { BookingStatus, BookingType } from "@/shared/config";
import { dayDateLabel } from "@/lib/dates";
import { useSelection, useTrip } from "@/lib/workspace/WorkspaceProvider";
import { BookingBadge, bookingWords } from "@/components/itinerary/badges";
import { SegmentedChips } from "@/components/ui";

/** 跨天預約總覽 checklist:按截止日排序,一眼看到還有什麼沒訂。 */
export function BookingOverview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { doc, editOps } = useTrip();
  const { setActiveDay, setSelectedStop } = useSelection();

  if (!open || !doc) return null;
  const days = [...doc.days].sort((a, b) => a.position - b.position);
  const dayIndexOf = new Map(days.map((d, i) => [d.id, i]));

  const stopById = new Map(doc.stops.map((s) => [s.id, s]));
  // 地點 + 交通(需購票的新幹線/機場快線等)一起列;統一形狀
  type Item = {
    kind: "stop" | "leg";
    id: string;
    name: string;
    dayId: string;
    startTime: string | null;
    bookingType: BookingType;
    bookingStatus: BookingStatus;
    booking: (typeof doc.stops)[number]["booking"];
    jumpStopId: string;
    legFromStopId?: string;
  };
  const items: Item[] = [
    ...doc.stops
      .filter((s) => s.bookingType !== "none")
      .map((s) => ({
        kind: "stop" as const,
        id: s.id,
        name: s.name,
        dayId: s.dayId,
        startTime: s.startTime,
        bookingType: s.bookingType,
        bookingStatus: s.bookingStatus,
        booking: s.booking,
        jumpStopId: s.id,
      })),
    ...doc.legs
      .filter((l) => l.bookingType !== "none")
      .map((l) => {
        const from = stopById.get(l.fromStopId);
        const to = stopById.get(l.toStopId);
        return {
          kind: "leg" as const,
          id: l.id,
          name: `${from?.name ?? "?"} → ${to?.name ?? "?"}(交通)`,
          dayId: from?.dayId ?? "",
          startTime: l.departureTime,
          bookingType: l.bookingType,
          bookingStatus: l.bookingStatus,
          booking: l.booking,
          jumpStopId: l.fromStopId,
          legFromStopId: l.fromStopId,
        };
      }),
  ].sort((a, b) => {
    // 未訂在前,依截止日近→遠;已訂沉底
    const rank = (s: Item) =>
      s.bookingStatus === "booked" ? 2 : s.bookingStatus === "unavailable" ? 1 : 0;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const da = a.booking?.deadline ?? "9999";
    const db = b.booking?.deadline ?? "9999";
    return da.localeCompare(db);
  });

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="tm-pop-in tm-scroll absolute top-0 right-0 flex h-full w-[380px] max-w-[92vw] flex-col overflow-y-auto border-l border-line bg-surface shadow-pop">
        <header className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
            <Ticket weight="fill" className="size-4.5 text-sun-deep" />
            預約總覽
          </h2>
          <button
            aria-label="關閉"
            onClick={onClose}
            className="tm-focus rounded-sm p-1 text-ink-faint hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-ink-faint">
            目前沒有需要預約或購票的項目。
            <br />
            可以問塔比:「有哪些行程必須先預約?」
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 p-3">
            {items.map((stop) => {
              const dayIdx = dayIndexOf.get(stop.dayId) ?? 0;
              const dateLabel = dayDateLabel(doc.trip.startDate, dayIdx);
              const deadlineDays = stop.booking?.deadline
                ? Math.ceil(
                    (new Date(stop.booking.deadline).getTime() - Date.now()) / 86_400_000,
                  )
                : null;
              const words = bookingWords(stop as never);
              return (
                <li key={stop.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setActiveDay(stop.dayId);
                      setSelectedStop(stop.jumpStopId);
                      onClose();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveDay(stop.dayId);
                        setSelectedStop(stop.jumpStopId);
                        onClose();
                      }
                    }}
                    className={cn(
                      "tm-focus w-full cursor-pointer rounded-lg border border-line p-3 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-card",
                      stop.bookingStatus === "booked" && "opacity-55",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-ink">
                        {stop.name}
                      </span>
                      <BookingBadge stop={stop as never} />
                    </div>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      Day {dayIdx + 1}
                      {dateLabel && ` · ${dateLabel}`}
                      {stop.startTime && (
                        <span className="tm-num"> · {stop.startTime}</span>
                      )}
                    </p>
                    {stop.booking?.note && (
                      <p className="mt-1 text-xs text-ink-soft">{stop.booking.note}</p>
                    )}
                    <div className="mt-1 flex items-center justify-between">
                      {stop.booking?.deadline ? (
                        <span
                          className={cn(
                            "tm-num text-[11px]",
                            deadlineDays != null && deadlineDays <= 7
                              ? "font-semibold text-alert"
                              : "text-ink-faint",
                          )}
                        >
                          截止 {stop.booking.deadline}
                          {deadlineDays != null && deadlineDays >= 0 && `(剩 ${deadlineDays} 天)`}
                        </span>
                      ) : (
                        <span />
                      )}
                      {stop.booking?.url && stop.bookingStatus !== "booked" && (
                        <span
                          role="link"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(stop.booking!.url, "_blank", "noreferrer");
                          }}
                          className="flex items-center gap-1 text-[11px] font-medium text-ocean-deep hover:underline"
                        >
                          <ArrowSquareOut className="size-3" />
                          前往預約
                        </span>
                      )}
                    </div>
                    {/* 直接在總覽切換狀態,不必點進詳情;現場排隊本來就不能訂,不顯示 */}
                    {stop.bookingType !== "walk_in_queue" && (
                    <div
                      className="mt-2"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <SegmentedChips
                        size="sm"
                        options={[
                          { value: "not_booked" as const, label: words.todo },
                          { value: "booked" as const, label: `${words.done} ✓` },
                          { value: "unavailable" as const, label: words.fail },
                        ]}
                        value={stop.bookingStatus}
                        onChange={(status) =>
                          editOps(
                            [
                              stop.kind === "leg"
                                ? {
                                    op: "set_leg_booking" as const,
                                    fromStopId: stop.legFromStopId!,
                                    bookingStatus: status,
                                  }
                                : {
                                    op: "update_stop" as const,
                                    stopId: stop.id,
                                    patch: { bookingStatus: status },
                                  },
                            ],
                            `${stop.name} 標記為${status === "booked" ? words.done : status === "unavailable" ? words.fail : words.todo}`,
                          )
                        }
                      />
                    </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
