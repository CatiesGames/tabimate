"use client";

import { cn } from "@/lib/cn";

type Tone = "neutral" | "coral" | "ocean" | "sun" | "leaf" | "alert";

const TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-soft",
  coral: "bg-coral-wash text-coral-deep",
  ocean: "bg-ocean-wash text-ocean-deep",
  sun: "bg-sun-wash text-sun-deep",
  leaf: "bg-leaf-wash text-leaf-deep",
  alert: "bg-alert-wash text-alert",
};

export function Tag({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
