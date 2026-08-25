"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 即時 hover tooltip(portal 定位、自動夾在螢幕內不被邊緣切到)。tip 可用 \n 換行。 */
export function Hint({
  tip,
  children,
  className,
}: {
  tip: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  // 量測 tooltip 寬度後夾進視窗(左右各留 8px)
  useLayoutEffect(() => {
    if (!anchor || !tipRef.current) return;
    const w = tipRef.current.offsetWidth;
    const margin = 8;
    const clamped = Math.min(
      Math.max(anchor.x, margin + w / 2),
      window.innerWidth - margin - w / 2,
    );
    setLeft(clamped);
  }, [anchor, tip]);

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) {
          setLeft(null);
          setAnchor({ x: r.left + r.width / 2, y: r.bottom + 7 });
        }
      }}
      onMouseLeave={() => setAnchor(null)}
    >
      {children}
      {anchor &&
        createPortal(
          <span
            ref={tipRef}
            style={{
              position: "fixed",
              left: left ?? anchor.x,
              top: anchor.y,
              transform: "translateX(-50%)",
              visibility: left === null ? "hidden" : "visible",
            }}
            className="pointer-events-none z-[60] max-w-[min(16rem,calc(100vw-16px))] rounded-md bg-ink px-2.5 py-1.5 text-center text-[11px] leading-relaxed whitespace-pre-line text-white shadow-pop"
          >
            {tip}
          </span>,
          document.body,
        )}
    </span>
  );
}
