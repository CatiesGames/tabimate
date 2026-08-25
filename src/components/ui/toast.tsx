"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Info, Warning } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { Avatar, type AvatarUser } from "./Avatar";

type Tone = "info" | "success" | "error";

export type ToastItem = {
  id: number;
  tone: Tone;
  message: string;
  /** 變更歸屬 toast:顯示是誰做的。 */
  actor?: AvatarUser;
};

type Listener = (t: ToastItem) => void;

let nextId = 1;
const listeners = new Set<Listener>();

export function toast(
  message: string,
  opts: { tone?: Tone; actor?: AvatarUser } = {},
) {
  const item: ToastItem = {
    id: nextId++,
    tone: opts.tone ?? "info",
    message,
    actor: opts.actor,
  };
  for (const fn of listeners) fn(item);
}

const TONE_ICON: Record<Tone, React.ReactNode> = {
  info: <Info weight="fill" className="size-4 text-ocean" />,
  success: <CheckCircle weight="fill" className="size-4 text-leaf" />,
  error: <Warning weight="fill" className="size-4 text-alert" />,
};

const DURATION_MS = 4200;

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast: Listener = (t) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, DURATION_MS);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2 max-md:inset-x-4 max-md:left-4"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "tm-pop-in pointer-events-auto flex items-center gap-2.5 rounded-lg border border-line bg-surface py-2.5 pr-4 pl-3 shadow-pop",
          )}
        >
          {t.actor ? <Avatar user={t.actor} size="sm" /> : TONE_ICON[t.tone]}
          <span className="text-[13px] text-ink">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
