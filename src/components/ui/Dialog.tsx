"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { Button } from "./Button";

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/35 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className={cn(
            "tm-pop-in fixed top-1/2 left-1/2 z-40 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-6 shadow-pop",
            className,
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <RadixDialog.Title className="font-display text-lg font-semibold text-ink">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                aria-label="關閉"
                className="tm-focus rounded-sm p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "確認",
  danger = false,
  loading = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <div className="text-sm text-ink-soft">{description}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
