"use client";

// 全站截斷提示:任何 truncate / line-clamp-* 元素實際被剪裁時,
// hover 自動顯示完整文字(事件委派,一處掛載全站生效,樣式同 Hint)。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function TruncationTipHost() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest?.(
        '.truncate, [class*="line-clamp-"]',
      ) as HTMLElement | null;
      if (!el) {
        setTip(null);
        return;
      }
      const clipped =
        el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      const text = (el.textContent ?? "").trim();
      if (!clipped || !text) {
        setTip(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setLeft(null);
      setTip({ text, x: r.left + r.width / 2, y: r.bottom + 7 });
    };
    const onLeave = () => setTip(null);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("scroll", onLeave, true);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("scroll", onLeave, true);
    };
  }, []);

  // 夾在視窗內(同 Hint)
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const w = tipRef.current.offsetWidth;
    const margin = 8;
    setLeft(Math.min(Math.max(tip.x, margin + w / 2), window.innerWidth - margin - w / 2));
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <span
      ref={tipRef}
      style={{
        position: "fixed",
        left: left ?? tip.x,
        top: tip.y,
        transform: "translateX(-50%)",
        visibility: left === null ? "hidden" : "visible",
      }}
      className="pointer-events-none z-[70] max-w-[min(20rem,calc(100vw-16px))] rounded-md bg-ink px-2.5 py-1.5 text-left text-[11px] leading-relaxed break-words whitespace-pre-line text-white shadow-pop"
    >
      {tip.text}
    </span>,
    document.body,
  );
}
