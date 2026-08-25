"use client";

import { cn } from "@/lib/cn";

/** 自訂開關(原生 checkbox 禁用)。 */
export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "tm-focus relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-leaf" : "bg-line-strong",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 block size-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}
