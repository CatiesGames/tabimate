"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";

/** 地點照片燈箱:大圖 + 左右/鍵盤輪播 + 底部縮圖列。大圖點開才載入(省照片額度)。 */
export function PhotoLightbox({
  photoRefs,
  name,
  initialIndex,
  onClose,
}: {
  photoRefs: string[];
  name: string;
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);

  const step = useCallback(
    (delta: number) => {
      setIndex((i) => (i + delta + photoRefs.length) % photoRefs.length);
    },
    [photoRefs.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        aria-label="關閉"
        onClick={onClose}
        className="tm-focus absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25"
      >
        <X weight="bold" className="size-5" />
      </button>

      <p className="tm-num absolute top-5 left-1/2 -translate-x-1/2 text-sm text-white/85">
        {name} · {index + 1} / {photoRefs.length}
      </p>

      <div
        className="flex w-full flex-1 items-center justify-center gap-2 px-2 py-14"
        onClick={(e) => e.stopPropagation()}
      >
        {photoRefs.length > 1 && (
          <button
            aria-label="上一張"
            onClick={() => step(-1)}
            className="tm-focus shrink-0 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
          >
            <CaretLeft weight="bold" className="size-5" />
          </button>
        )}
        <img
          key={photoRefs[index]}
          src={`/api/google/photo?ref=${encodeURIComponent(photoRefs[index])}&w=1000`}
          alt={`${name} 照片 ${index + 1}`}
          className="tm-pop-in max-h-full min-h-0 max-w-[calc(100vw-140px)] rounded-lg object-contain shadow-pop max-md:max-w-[calc(100vw-16px)]"
        />
        {photoRefs.length > 1 && (
          <button
            aria-label="下一張"
            onClick={() => step(1)}
            className="tm-focus shrink-0 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
          >
            <CaretRight weight="bold" className="size-5" />
          </button>
        )}
      </div>

      {photoRefs.length > 1 && (
        <div
          className="tm-scroll mb-4 flex max-w-[92vw] gap-1.5 overflow-x-auto px-2"
          onClick={(e) => e.stopPropagation()}
        >
          {photoRefs.map((ref, i) => (
            <button
              key={ref}
              aria-label={`第 ${i + 1} 張`}
              onClick={() => setIndex(i)}
              className={cn(
                "shrink-0 overflow-hidden rounded-md transition-[opacity,box-shadow]",
                i === index
                  ? "opacity-100 ring-2 ring-white"
                  : "opacity-50 hover:opacity-80",
              )}
            >
              <img
                src={`/api/google/photo?ref=${encodeURIComponent(ref)}&w=400`}
                alt=""
                className="h-12 w-16 object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
