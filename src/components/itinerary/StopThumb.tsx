"use client";

import { useState } from "react";

import { CATEGORY_META } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/workspace/WorkspaceProvider";
import type { Stop } from "@/shared/types";

/** stop 縮圖:Google 地點照片(代理+快取);無照片/無 key → 分類色塊 + icon。 */
export function StopThumb({
  stop,
  className,
  // 與詳情面板共用 400px:同一 photoRef 只算一次 Google 呼叫(磁碟快取同 key)
  width = 400,
}: {
  stop: Stop;
  className?: string;
  width?: number;
}) {
  const { googleReady } = useSession();
  const [failed, setFailed] = useState(false);
  const meta = CATEGORY_META[stop.category];
  const Icon = meta.icon;
  const ref = stop.place?.photoRefs?.[0];

  if (googleReady && ref && !failed) {
    return (
      <img
        src={`/api/google/photo?ref=${encodeURIComponent(ref)}&w=${width}`}
        alt={stop.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("rounded-md object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn("flex items-center justify-center rounded-md", className)}
      style={{ backgroundColor: `color-mix(in srgb, ${meta.colorVar} 14%, white)` }}
    >
      <Icon weight="duotone" className="size-6" style={{ color: meta.colorVar }} />
    </span>
  );
}
