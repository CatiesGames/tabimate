"use client";

import { cn } from "@/lib/cn";

export function Input({
  className,
  ...rest
}: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "tm-focus h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink",
        "placeholder:text-ink-faint",
        "transition-[border-color,box-shadow] duration-150",
        "focus-visible:border-ocean focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean/25",
        "disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      {...rest}
    />
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-ink-faint">{hint}</span>}
      {error && <span className="text-xs text-alert">{error}</span>}
    </label>
  );
}
