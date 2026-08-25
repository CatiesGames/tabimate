"use client";

import { CircleNotch } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <CircleNotch
      weight="bold"
      className={cn("size-5 animate-[tm-spin_0.8s_linear_infinite] text-ocean", className)}
    />
  );
}

/** agent 思考中的三點脈動。 */
export function PulseDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label="思考中">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-ocean"
          style={{
            animation: "tm-pulse-dot 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("tm-skeleton rounded-md", className)} />;
}
