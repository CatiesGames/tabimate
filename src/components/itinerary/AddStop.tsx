"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { Bed, MagnifyingGlass, MapPin, Plus } from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { CATEGORY_META, guessCategory } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { carryOverLodging, primaryLodgingOf } from "@/shared/conflicts";
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

export function AddStop({
  dayId,
  position,
}: {
  dayId: string;
  position?: number;
}) {
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
  // 桌面=Radix Popover 懸浮(與安排交通同機制);手機=底部抽屜
  const [narrow, setNarrow] = useState(false);



  // 以行程中已有座標的點做搜尋偏好中心
  const near = doc?.stops.find((s) => s.lat != null && s.lng != null);

  // 「回飯店休息」快捷:當天有可回的過夜住宿(續住或當天入住)就一鍵加卡,不用搜尋
  const restHotel = (() => {
    if (!doc) return null;
    const carry = carryOverLodging(doc.days, doc.stops, dayId);
    // 退房日行李已退,不提供「回飯店休息」
    if (carry) return carry.isCheckoutDay ? null : carry.stop;
    const primary = primaryLodgingOf(doc.days, doc.stops, dayId);
    if (!primary) return null;
    // check-in(主卡)之前的位置不提供(還沒入住)
    const ordered = doc.stops
      .filter((s) => s.dayId === dayId)
      .sort((a, b) => a.position - b.position);
    const insertAt = position ?? ordered.length;
    return insertAt > ordered.indexOf(primary) ? primary : null;
  })();

  const addRest = async () => {
    if (!restHotel) return;
    const dayStops = (doc?.stops ?? [])
      .filter((s) => s.dayId === dayId)
      .sort((a, b) => a.position - b.position);
    const prev = position != null ? dayStops[position - 1] : dayStops.at(-1);
    // 預設接續前一項,休息 2 小時(起訖同日才會被視為休息而非過夜)
    const start = prev?.endTime ?? prev?.startTime ?? "14:00";
    const h = Number(start.slice(0, 2));
    const end = `${String(Math.min(h + 2, 23)).padStart(2, "0")}${start.slice(2)}`;
    await editOps(
      [
        {
          op: "add_stop",
          tempId: "rest",
          dayId,
          position,
          name: restHotel.name,
          category: "lodging",
          placeId: restHotel.placeId,
          lat: restHotel.lat,
          lng: restHotel.lng,
          address: restHotel.address,
          startTime: start,
          endTime: end,
          notes: "回飯店休息",
        },
        ...(restHotel.place
          ? [
              {
                op: "update_stop" as const,
                stopId: "$rest",
                patch: { place: restHotel.place },
              },
            ]
          : []),
      ],
      `回 ${restHotel.name} 休息`,
    );
    setMode("idle");
    setQuery("");
  };

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
            position,
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
        [{ op: "add_stop", dayId, position, name: r.mainText, category, placeId: r.placeId }],
        `新增 ${r.mainText}`,
      );
    }
    setAdding(null);
    setQuery("");
    setResults([]);
    setMode("idle");
  };

  const body =
    mode === "manual" ? (
      <div ref={boxRef} className="rounded-xl border border-line bg-surface shadow-pop">
        <ManualForm
          dayId={dayId}
          position={position}
          initialName={query}
          onDone={() => {
            setMode("idle");
            setQuery("");
          }}
        />
      </div>
    ) : (
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

      {restHotel && !query.trim() && (
        <button
          onClick={addRest}
          className="tm-focus mt-1.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-cat-lodging/10"
        >
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: "var(--tm-cat-lodging)" }}
          >
            <Bed weight="fill" className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            回 <span className="font-medium">{restHotel.name}</span> 休息
          </span>
          <span className="shrink-0 text-[11px] text-ink-faint">帶入預設時段,可再調</span>
        </button>
      )}

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

  const openChange = (o: boolean) => {
    if (o) {
      setNarrow(window.innerWidth < 768);
      setMode("search");
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setMode("idle");
      setQuery("");
      setResults([]);
    }
  };

  return (
    <Popover.Root open={mode !== "idle"} onOpenChange={openChange}>
      <Popover.Trigger asChild>
        <button className="tm-focus flex shrink-0 items-center gap-1 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-xs text-ink-soft transition-[color,border-color,background-color] hover:border-coral hover:bg-coral-wash hover:text-coral-deep data-[state=open]:border-coral data-[state=open]:text-coral-deep">
          <Plus weight="bold" className="size-3.5" />
          新增地點
        </button>
      </Popover.Trigger>
      {!narrow && mode !== "idle" && (
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={10}
            className="tm-pop-in z-40 w-[min(340px,calc(100vw-20px))]"
            onClick={(e) => e.stopPropagation()}
          >
            {body}
          </Popover.Content>
        </Popover.Portal>
      )}
      {narrow &&
        mode !== "idle" &&
        createPortal(
          <div className="fixed inset-0 z-40">
            <div
              className="absolute inset-0 bg-ink/25 backdrop-blur-[1px]"
              onMouseDown={() => openChange(false)}
            />
            <div className="tm-pop-in absolute inset-x-2 bottom-[calc(3.8rem+env(safe-area-inset-bottom))] max-h-[70dvh] overflow-y-auto">
              {body}
            </div>
          </div>,
          document.body,
        )}
    </Popover.Root>
  );
}

function ManualForm({
  dayId,
  position,
  initialName,
  onDone,
}: {
  dayId: string;
  position?: number;
  initialName: string;
  onDone: () => void;
}) {
  const { doc, editOps } = useTrip();
  const ordered = (doc?.stops ?? [])
    .filter((s) => s.dayId === dayId)
    .sort((a, b) => a.position - b.position);
  // 插入點的前後項:前段交通抵達 > 前一項結束/開始 > 後一項開始(標「銜接後一項」)
  const prevStop = position != null ? ordered[position - 1] : ordered.at(-1);
  const nextStop = position != null ? (ordered[position] ?? null) : null;
  const prevLeg = prevStop
    ? (doc?.legs ?? []).find((l) => l.fromStopId === prevStop.id) ?? null
    : null;
  const timeDefault =
    prevLeg?.arrivalTime ?? prevStop?.endTime ?? prevStop?.startTime ?? nextStop?.startTime ?? null;
  const timeLabel =
    prevLeg?.arrivalTime || prevStop?.endTime || prevStop?.startTime
      ? "接續前一項"
      : nextStop?.startTime
        ? "銜接後一項"
        : null;
  const [name, setName] = useState(initialName.trim());
  const [category, setCategory] = useState<StopCategory>("sight");
  const [time, setTime] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const submit = async () => {
    if (!name.trim()) return;
    await editOps(
      [{ op: "add_stop", dayId, position, name: name.trim(), category, startTime: time }],
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
          defaultTime={timeDefault}
          defaultLabel={timeLabel}
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
