"use client";

// 自訂日期選擇(禁用原生 date input):按鈕 → 月曆 popover。
// 與 TimeField 同語彙;ISO(YYYY-MM-DD)字串進出,字串比較即可判先後。
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarBlank, CaretLeft, CaretRight } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { todayISO } from "@/lib/dates";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (n: number) => String(n).padStart(2, "0");

export function DateField({
  value,
  onChange,
  min,
  placeholder = "選日期",
  clearable,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  /** 早於這天的日子不可選(ISO)。 */
  min?: string | null;
  placeholder?: string;
  /** 顯示「清除日期」。 */
  clearable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: 2000, m: 1 });

  const openPicker = (o: boolean) => {
    setOpen(o);
    if (o) {
      const base = value ?? min ?? todayISO();
      setView({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) });
    }
  };
  const shiftMonth = (n: number) =>
    setView((v) => {
      const m = v.m + n;
      if (m < 1) return { y: v.y - 1, m: 12 };
      if (m > 12) return { y: v.y + 1, m: 1 };
      return { ...v, m };
    });

  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const firstWeekday = new Date(view.y, view.m - 1, 1).getDay();
  const label = value
    ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))} (${WEEKDAYS[new Date(`${value}T00:00:00`).getDay()]})`
    : null;

  return (
    <Popover.Root open={open} onOpenChange={openPicker}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "tm-focus inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm transition-colors",
            value ? "tm-num text-ink" : "text-ink-faint",
            open && "border-ocean ring-2 ring-ocean/25",
            className,
          )}
        >
          <CalendarBlank className="size-4 shrink-0 text-ink-faint" />
          {label ?? placeholder}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={10}
          className="tm-pop-in z-50 w-[264px] rounded-xl border border-line bg-surface p-3 shadow-pop"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              aria-label="上個月"
              onClick={() => shiftMonth(-1)}
              className="tm-focus rounded-md p-1.5 text-ink-soft hover:bg-sunken"
            >
              <CaretLeft weight="bold" className="size-3.5" />
            </button>
            <span className="tm-num text-sm font-semibold text-ink">
              {view.y} 年 {view.m} 月
            </span>
            <button
              aria-label="下個月"
              onClick={() => shiftMonth(1)}
              className="tm-focus rounded-md p-1.5 text-ink-soft hover:bg-sunken"
            >
              <CaretRight weight="bold" className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-[11px] text-ink-faint">
                {w}
              </span>
            ))}
            {Array.from({ length: firstWeekday }, (_, i) => (
              <span key={`e${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const iso = `${view.y}-${pad(view.m)}-${pad(i + 1)}`;
              const disabled = !!min && iso < min;
              const selected = iso === value;
              const isToday = iso === todayISO();
              return (
                <button
                  key={iso}
                  disabled={disabled}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={cn(
                    "tm-focus tm-num flex size-8 items-center justify-center rounded-md text-[13px] transition-colors",
                    selected
                      ? "bg-coral font-semibold text-white"
                      : disabled
                        ? "text-ink-faint/40"
                        : "text-ink hover:bg-sunken",
                    isToday && !selected && "font-semibold text-coral-deep",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          {clearable && value && (
            <button
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="tm-focus mt-2 w-full rounded-md py-1.5 text-center text-xs text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
            >
              清除日期
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * 日期區間選擇(機票訂票式):同一個月曆內點第一下=出發日、第二下=最後一天,
 * 點在出發日之前則重新起算;選完訖日自動關閉。
 */
export function DateRangeField({
  start,
  end,
  onChange,
  placeholder = "選日期區間",
  clearable,
  className,
}: {
  start: string | null;
  /** 已知的最後一天(顯示與 range 標示用)。 */
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: 2000, m: 1 });
  /** 選取階段:開啟後第一下重設起日並進入選訖日;hover 預覽區間。 */
  const [picking, setPicking] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const openPicker = (o: boolean) => {
    setOpen(o);
    setPicking(false);
    setHover(null);
    if (o) {
      const base = start ?? todayISO();
      setView({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) });
    }
  };
  const shiftMonth = (n: number) =>
    setView((v) => {
      const m = v.m + n;
      if (m < 1) return { y: v.y - 1, m: 12 };
      if (m > 12) return { y: v.y + 1, m: 1 };
      return { ...v, m };
    });

  const pick = (iso: string) => {
    if (!picking || !start || iso < start) {
      // 第一下(或點在起日前):重新起算
      onChange(iso, null);
      setPicking(true);
    } else {
      onChange(start, iso);
      setOpen(false);
    }
  };

  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const firstWeekday = new Date(view.y, view.m - 1, 1).getDay();
  const fmt = (iso: string) =>
    `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} (${WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()]})`;
  const label = start ? `${fmt(start)} → ${end ? fmt(end) : "?"}` : null;
  // 選訖日過程中以 hover 預覽區間
  const previewEnd = picking ? (hover && start && hover > start ? hover : null) : end;

  return (
    <Popover.Root open={open} onOpenChange={openPicker}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "tm-focus inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm transition-colors",
            start ? "tm-num text-ink" : "text-ink-faint",
            open && "border-ocean ring-2 ring-ocean/25",
            className,
          )}
        >
          <CalendarBlank className="size-4 shrink-0 text-ink-faint" />
          {label ?? placeholder}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={10}
          className="tm-pop-in z-50 w-[280px] rounded-xl border border-line bg-surface p-3 shadow-pop"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-1.5 text-center text-[11px] text-ink-faint">
            {picking && start ? `出發 ${fmt(start)},再點最後一天` : "點兩下選出發日與最後一天"}
          </p>
          <div className="mb-2 flex items-center justify-between">
            <button
              aria-label="上個月"
              onClick={() => shiftMonth(-1)}
              className="tm-focus rounded-md p-1.5 text-ink-soft hover:bg-sunken"
            >
              <CaretLeft weight="bold" className="size-3.5" />
            </button>
            <span className="tm-num text-sm font-semibold text-ink">
              {view.y} 年 {view.m} 月
            </span>
            <button
              aria-label="下個月"
              onClick={() => shiftMonth(1)}
              className="tm-focus rounded-md p-1.5 text-ink-soft hover:bg-sunken"
            >
              <CaretRight weight="bold" className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-y-0.5 text-center" onMouseLeave={() => setHover(null)}>
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-[11px] text-ink-faint">
                {w}
              </span>
            ))}
            {Array.from({ length: firstWeekday }, (_, i) => (
              <span key={`e${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const iso = `${view.y}-${pad(view.m)}-${pad(i + 1)}`;
              const isStart = iso === start;
              const isEnd = previewEnd != null && iso === previewEnd;
              const inRange =
                start != null && previewEnd != null && iso > start && iso < previewEnd;
              const isToday = iso === todayISO();
              return (
                <button
                  key={iso}
                  onClick={() => pick(iso)}
                  onMouseEnter={() => setHover(iso)}
                  className={cn(
                    "tm-focus tm-num mx-auto flex size-8 items-center justify-center text-[13px] transition-colors",
                    isStart || isEnd
                      ? "rounded-md bg-coral font-semibold text-white"
                      : inRange
                        ? "rounded-none bg-coral-wash text-coral-deep"
                        : "rounded-md text-ink hover:bg-sunken",
                    isToday && !isStart && !isEnd && !inRange && "font-semibold text-coral-deep",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          {clearable && start && (
            <button
              onClick={() => {
                onChange(null, null);
                setPicking(false);
                setOpen(false);
              }}
              className="tm-focus mt-2 w-full rounded-md py-1.5 text-center text-xs text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
            >
              清除日期
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
