"use client";

import { CircleNotch } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "soft" | "ghost" | "danger" | "ocean";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-coral text-white hover:bg-coral-deep shadow-[0_2px_8px_-2px_rgb(255_93_71/0.5)]",
  ocean:
    "bg-ocean text-white hover:bg-ocean-deep shadow-[0_2px_8px_-2px_rgb(14_155_164/0.5)]",
  soft: "bg-coral-wash text-coral-deep hover:bg-[#ffe1db]",
  ghost: "bg-transparent text-ink-soft hover:bg-sunken hover:text-ink",
  danger: "bg-alert text-white hover:bg-[#c92f2f]",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-sm",
  md: "h-10 px-4 text-sm gap-2 rounded-md",
  lg: "h-12 px-6 text-base gap-2 rounded-md",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "tm-focus inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,transform,box-shadow,opacity] duration-150",
        "active:translate-y-px active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <CircleNotch
          weight="bold"
          className="size-4 shrink-0 animate-[tm-spin_0.8s_linear_infinite]"
        />
      )}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  size = "md",
  variant = "ghost",
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: Size;
  variant?: Variant;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "tm-focus inline-flex shrink-0 select-none items-center justify-center transition-[background-color,transform] duration-150",
        "active:scale-[0.94] disabled:pointer-events-none disabled:opacity-45",
        VARIANT[variant],
        size === "sm" && "size-8 rounded-sm",
        size === "md" && "size-10 rounded-md",
        size === "lg" && "size-12 rounded-md",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
