"use client";

import { cn } from "@/lib/cn";

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
};

/** inline 單選 chip 列 — 選項少時取代下拉,一次點擊完成。 */
export function SegmentedChips<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: ChipOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "tm-focus inline-flex select-none items-center gap-1.5 rounded-full border font-medium transition-[background-color,border-color,color,transform] duration-150",
              "active:scale-[0.96]",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-[13px]",
              active
                ? "border-coral bg-coral-wash text-coral-deep"
                : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
            )}
            type="button"
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
