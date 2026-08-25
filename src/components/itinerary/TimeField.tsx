"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Clock, MagicWand, X } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";

const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

/**
 * 自訂時間選擇器:點開 → 選時 → 選分,兩擊完成自動關閉。
 * defaultTime:依上下文建議的時間 — 無值時預選該小時,並提供一鍵帶入。
 * defaultLabel:帶入 chip 的來源說明(預設「接續前一項」;傳 null = 只預選小時不顯示 chip)。
 */
export function TimeField({
  value,
  onChange,
  placeholder = "--:--",
  defaultTime,
  defaultLabel = "接續前一項",
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  defaultTime?: string | null;
  defaultLabel?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pendingHour, setPendingHour] = useState<number | null>(null);

  const openPicker = (o: boolean) => {
    setOpen(o);
    if (o) {
      const base = value ?? defaultTime ?? null;
      setPendingHour(base ? Number(base.slice(0, 2)) : null);
    }
  };

  const commit = (h: number, m: string) => {
    onChange(`${String(h).padStart(2, "0")}:${m}`);
    setOpen(false);
  };

  const selectedMinute = (value ?? defaultTime)?.slice(3, 5);
  const hourForMinutes =
    pendingHour ?? Number((value ?? defaultTime ?? "09:00").slice(0, 2));

  return (
    <Popover.Root open={open} onOpenChange={openPicker}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "tm-focus tm-num inline-flex h-8 w-[4.5rem] items-center justify-center gap-1 rounded-sm border border-line bg-surface text-sm transition-colors",
            value ? "text-ink" : "text-ink-faint",
            open && "border-ocean ring-2 ring-ocean/25",
            className,
          )}
        >
          <Clock className="size-3.5 shrink-0 text-ink-faint" />
          {value ?? placeholder}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={10}
          className="tm-pop-in z-50 w-[min(248px,calc(100vw-20px))] rounded-lg border border-line bg-surface p-3 shadow-pop"
          onClick={(e) => e.stopPropagation()}
        >
          {!value && defaultTime && defaultLabel && (
            <button
              type="button"
              onClick={() => commit(Number(defaultTime.slice(0, 2)), defaultTime.slice(3, 5))}
              className="tm-focus tm-num mb-2.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-ocean-wash py-1.5 text-xs font-medium text-ocean-deep transition-colors hover:bg-ocean hover:text-white"
            >
              <MagicWand weight="fill" className="size-3.5" />
              帶入 {defaultTime}({defaultLabel})
            </button>
          )}
          <p className="mb-1.5 text-[11px] font-medium text-ink-faint">時</p>
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: 24 }, (_, h) => (
              <button
                key={h}
                type="button"
                onClick={() => setPendingHour(h)}
                className={cn(
                  "tm-num tm-focus h-7 rounded-sm text-xs transition-colors",
                  pendingHour === h
                    ? "bg-ocean font-semibold text-white"
                    : "text-ink-soft hover:bg-sunken",
                )}
              >
                {String(h).padStart(2, "0")}
              </button>
            ))}
          </div>
          <p className="mt-2.5 mb-1.5 text-[11px] font-medium text-ink-faint">分</p>
          <div className="grid grid-cols-6 gap-1">
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => commit(hourForMinutes, m)}
                className={cn(
                  "tm-num tm-focus h-7 rounded-sm text-xs transition-colors",
                  pendingHour != null
                    ? "bg-ocean-wash text-ocean-deep hover:bg-ocean hover:text-white"
                    : selectedMinute === m
                      ? "bg-ocean font-semibold text-white"
                      : "text-ink-soft hover:bg-sunken",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="tm-focus mt-2.5 flex w-full items-center justify-center gap-1 rounded-sm py-1.5 text-xs text-ink-faint transition-colors hover:bg-alert-wash hover:text-alert"
            >
              <X className="size-3" />
              清除時間
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
