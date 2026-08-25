"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MagnifyingGlass, MapPin, Plus } from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { CATEGORY_META, guessCategory } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { STOP_CATEGORIES, type StopCategory } from "@/shared/config";
import type { PlaceInfo } from "@/shared/types";
import { useSession, useTrip } from "@/lib/workspace/WorkspaceProvider";
import { Button, Input, SegmentedChips, Spinner } from "@/components/ui";
import { TimeField } from "./TimeField";

type AcResult = {
  placeId: string;
  mainText: string;
  secondaryText: string;
  types: string[];
};

// client LRU:同 query 立即回快取結果(server 端另有 30 天快取)
const lru = new Map<string, AcResult[]>();
function lruGet(q: string): AcResult[] | undefined {
  const hit = lru.get(q);
  if (hit) {
    lru.delete(q);
    lru.set(q, hit);
  }
  return hit;
}
function lruSet(q: string, v: AcResult[]) {
  lru.set(q, v);
  if (lru.size > 80) lru.delete(lru.keys().next().value!);
}

type Mode = "idle" | "search" | "manual";

export function AddStop({ dayId }: { dayId: string }) {
  const { googleReady } = useSession();
  const { doc, editOps } = useTrip();
  const [mode, setMode] = useState<Mode>("idle");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AcResult[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // 以行程中已有座標的點做搜尋偏好中心
  const near = doc?.stops.find((s) => s.lat != null && s.lng != null);

  const search = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        return;
      }
      const cached = lruGet(trimmed);
      if (cached) setResults(cached);
      setLoading(true);
      const params = new URLSearchParams({ q: trimmed });
      if (near?.lat != null && near.lng != null) {
        params.set("lat", String(near.lat));
        params.set("lng", String(near.lng));
      }
      apiFetch<{ results: AcResult[] }>(`/api/google/autocomplete?${params}`)
        .then((d) => {
          lruSet(trimmed, d.results);
          setResults(d.results);
          setHighlight(0);
        })
        .catch(() => {
          // key 未設定等:留在手動路徑
        })
        .finally(() => setLoading(false));
    },
    [near],
  );

  // 200ms debounce
  useEffect(() => {
    if (mode !== "search") return;
    const t = setTimeout(() => search(query), 200);
    return () => clearTimeout(t);
  }, [query, mode, search]);

  // 點外面收合
  useEffect(() => {
    if (mode === "idle") return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setMode("idle");
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [mode]);

  const addFromPlace = async (r: AcResult) => {
    setAdding(r.placeId);
    let category = guessCategory(r.types);
    let extras: Record<string, unknown> = {};
    try {
      const { place } = await apiFetch<{
        place: {
          lat: number;
          lng: number;
          address: string;
          rating?: number;
          userRatingCount?: number;
          openingHours?: string[];
          photoRefs: string[];
          website?: string;
          phone?: string;
          googleMapsUri?: string;
          types: string[];
        };
      }>(`/api/google/place/${encodeURIComponent(r.placeId)}`);
      category = guessCategory(place.types.length ? place.types : r.types);
      const placeInfo: PlaceInfo = {
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        openingHours: place.openingHours,
        photoRefs: place.photoRefs,
        website: place.website,
        phone: place.phone,
        googleMapsUri: place.googleMapsUri,
      };
      extras = {
        lat: place.lat,
        lng: place.lng,
        address: place.address,
      };
      await editOps(
        [
          {
            op: "add_stop",
            tempId: "new",
            dayId,
            name: r.mainText,
            category,
            placeId: r.placeId,
            ...extras,
          },
          // place 詳情(photos/hours)在同一批寫入
          { op: "update_stop", stopId: "$new", patch: { place: placeInfo } },
        ],
        `新增 ${r.mainText}`,
      );
    } catch {
      // 詳情抓不到就純名稱加入
      await editOps(
        [{ op: "add_stop", dayId, name: r.mainText, category, placeId: r.placeId }],
        `新增 ${r.mainText}`,
      );
    }
    setAdding(null);
    setQuery("");
    setResults([]);
    setMode("idle");
  };

  if (mode === "idle") {
    return (
      <button
        onClick={() => {
          setMode("search");
          setTimeout(() => inputRef.current?.focus(), 30);
        }}
        className="tm-focus flex w-full select-none items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong py-2.5 text-sm text-ink-faint transition-colors hover:border-coral hover:bg-coral-wash/40 hover:text-coral-deep"
      >
        <Plus weight="bold" className="size-4" />
        新增地點
      </button>
    );
  }

  if (mode === "manual") {
    return (
      <div ref={boxRef}>
        <ManualForm
          dayId={dayId}
          initialName={query}
          onDone={() => {
            setMode("idle");
            setQuery("");
          }}
        />
      </div>
    );
  }

  return (
    <div ref={boxRef} className="tm-pop-in rounded-lg border border-line bg-surface p-2 shadow-lift">
      <div className="relative">
        <MagnifyingGlass className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-faint" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // IME 組字中(注音/拼音選字)的 Enter 不當作確定
            if (e.key === "Enter" && e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (googleReady && results[highlight]) addFromPlace(results[highlight]);
              else if (query.trim()) setMode("manual");
            } else if (e.key === "Escape") {
              setMode("idle");
            }
          }}
          placeholder={googleReady ? "搜尋地點,例如「東京鐵塔」" : "輸入地點名稱"}
          className="!h-9 pl-8 text-sm"
        />
        {loading && <Spinner className="absolute top-1/2 right-2 size-4 -translate-y-1/2" />}
      </div>

      {googleReady && results.length > 0 && (
        <ul className="mt-1.5 flex flex-col">
          {results.slice(0, 6).map((r, i) => {
            const cat = guessCategory(r.types);
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            return (
              <li key={r.placeId}>
                <button
                  onClick={() => addFromPlace(r)}
                  onMouseEnter={() => setHighlight(i)}
                  disabled={adding !== null}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                    i === highlight ? "bg-coral-wash" : "hover:bg-sunken",
                  )}
                >
                  <Icon
                    weight="duotone"
                    className="size-4 shrink-0"
                    style={{ color: meta.colorVar }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{r.mainText}</span>
                    <span className="block truncate text-xs text-ink-faint">
                      {r.secondaryText}
                    </span>
                  </span>
                  {adding === r.placeId && <Spinner className="size-4" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        onClick={() => setMode("manual")}
        className="tm-focus mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink-soft transition-colors hover:bg-sunken"
      >
        <MapPin className="size-4 text-ink-faint" />
        {query.trim() ? `手動新增「${query.trim()}」` : "手動新增(自填名稱)"}
      </button>
    </div>
  );
}

function ManualForm({
  dayId,
  initialName,
  onDone,
}: {
  dayId: string;
  initialName: string;
  onDone: () => void;
}) {
  const { doc, editOps } = useTrip();
  const lastStop = (doc?.stops ?? [])
    .filter((s) => s.dayId === dayId)
    .sort((a, b) => a.position - b.position)
    .at(-1);
  const [name, setName] = useState(initialName.trim());
  const [category, setCategory] = useState<StopCategory>("sight");
  const [time, setTime] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const submit = async () => {
    if (!name.trim()) return;
    await editOps(
      [{ op: "add_stop", dayId, name: name.trim(), category, startTime: time }],
      `新增 ${name.trim()}`,
    );
    onDone();
  };

  return (
    <div className="tm-pop-in flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3 shadow-lift">
      <Input
        ref={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()}
        placeholder="地點名稱"
        className="!h-9 text-sm"
      />
      <SegmentedChips
        size="sm"
        options={STOP_CATEGORIES.map((c) => {
          const meta = CATEGORY_META[c];
          const Icon = meta.icon;
          return {
            value: c,
            label: meta.label,
            icon: <Icon weight="duotone" className="size-3.5" style={{ color: meta.colorVar }} />,
          };
        })}
        value={category}
        onChange={setCategory}
      />
      <div className="flex items-center justify-between">
        <TimeField
          value={time}
          onChange={setTime}
          placeholder="時間"
          defaultTime={lastStop?.endTime ?? lastStop?.startTime ?? null}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDone}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={!name.trim()}>
            加入
          </Button>
        </div>
      </div>
    </div>
  );
}
