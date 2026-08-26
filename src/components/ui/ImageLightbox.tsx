"use client";

// 全站統一的圖片燈箱:大圖 + 左右/鍵盤輪播 + 底部縮圖列。
// 任何可點擊放大的圖片(聊天附圖、塔比附圖、地點照片)都用同一個元件,行為一致。
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";

export type LightboxImage = {
  /** 大圖 URL。 */
  src: string;
  /** 縮圖列用(省流量);不給就用 src。 */
  thumb?: string;
  alt?: string;
};

export function ImageLightbox({
  images,
  name,
  initialIndex,
  onClose,
}: {
  images: LightboxImage[];
  name: string;
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);

  const step = useCallback(
    (delta: number) => {
      setIndex((i) => (i + delta + images.length) % images.length);
    },
    [images.length],
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

  const current = images[index];
  if (!current) return null;

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
        {name}
        {images.length > 1 && ` · ${index + 1} / ${images.length}`}
      </p>

      <div
        className="flex w-full flex-1 items-center justify-center gap-2 px-2 py-14"
        onClick={(e) => e.stopPropagation()}
      >
        {images.length > 1 && (
          <button
            aria-label="上一張"
            onClick={() => step(-1)}
            className="tm-focus shrink-0 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
          >
            <CaretLeft weight="bold" className="size-5" />
          </button>
        )}
        <img
          key={current.src}
          src={current.src}
          alt={current.alt ?? `${name} 照片 ${index + 1}`}
          className="tm-pop-in max-h-full min-h-0 max-w-[calc(100vw-140px)] rounded-lg object-contain shadow-pop max-md:max-w-[calc(100vw-16px)]"
        />
        {images.length > 1 && (
          <button
            aria-label="下一張"
            onClick={() => step(1)}
            className="tm-focus shrink-0 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
          >
            <CaretRight weight="bold" className="size-5" />
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div
          className="tm-scroll mb-4 flex max-w-[92vw] gap-1.5 overflow-x-auto px-2"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((img, i) => (
            <button
              key={img.src}
              aria-label={`第 ${i + 1} 張`}
              onClick={() => setIndex(i)}
              className={cn(
                "shrink-0 overflow-hidden rounded-md transition-[opacity,box-shadow]",
                i === index ? "opacity-100 ring-2 ring-white" : "opacity-50 hover:opacity-80",
              )}
            >
              <img src={img.thumb ?? img.src} alt="" className="h-12 w-16 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * 可點擊放大的圖片:全站附圖統一入口(點擊 → ImageLightbox)。
 * hideOnError 時載入失敗整顆隱藏(外部圖用)。
 */
export function ZoomableImage({
  src,
  zoomSrc,
  alt,
  className,
  wrapperClassName,
  hideOnError,
}: {
  src: string;
  /** 燈箱用的大圖 URL(不給就用 src)。 */
  zoomSrc?: string;
  alt?: string;
  className?: string;
  wrapperClassName?: string;
  hideOnError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={alt ? `放大 ${alt}` : "放大圖片"}
        onClick={() => setOpen(true)}
        className={cn("tm-focus cursor-zoom-in align-top", wrapperClassName)}
      >
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          onError={(e) => {
            if (hideOnError) {
              const btn = (e.currentTarget as HTMLImageElement).closest("button");
              if (btn) (btn as HTMLElement).style.display = "none";
            }
          }}
          className={className}
        />
      </button>
      {open && (
        <ImageLightbox
          images={[{ src: zoomSrc ?? src, alt }]}
          name={alt ?? "圖片"}
          initialIndex={0}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
