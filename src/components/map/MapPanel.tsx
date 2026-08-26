"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdvancedMarker,
  APIProvider,
  Map as GMap,
  useMap,
} from "@vis.gl/react-google-maps";
import { Bed, MapTrifold, Plus, X } from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { CATEGORY_META, guessCategory } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { carryOverLodging } from "@/shared/conflicts";
import type { Leg, Stop } from "@/shared/types";
import {
  useSelection,
  useSession,
  useTrip,
} from "@/lib/workspace/WorkspaceProvider";
import { Button, Spinner } from "@/components/ui";

export function MapPanel() {
  const { mapsBrowserKey } = useSession();
  if (!mapsBrowserKey) return <MapFallback />;
  return (
    <APIProvider apiKey={mapsBrowserKey} language="zh-TW" region="TW">
      <MapCanvas />
    </APIProvider>
  );
}

function dayStopsOf(
  doc: NonNullable<ReturnType<typeof useTrip>["doc"]>,
  dayId: string | null,
): Stop[] {
  if (!dayId) return [];
  return doc.stops
    .filter((s) => s.dayId === dayId)
    .sort((a, b) => a.position - b.position);
}

// ---- 真地圖 ----

function MapCanvas() {
  const { doc, changedStopIds } = useTrip();
  const { activeDayId, selectedStopId, setSelectedStop } = useSelection();
  const stops = useMemo(
    () => (doc ? dayStopsOf(doc, activeDayId) : []),
    [doc, activeDayId],
  );
  const located = stops.filter((s) => s.lat != null && s.lng != null);
  // 續住日的住宿(當天起點/終點):地圖也要標,才看得出從哪出發、回哪裡住
  const carry = useMemo(
    () => (doc && activeDayId ? carryOverLodging(doc.days, doc.stops, activeDayId) : null),
    [doc, activeDayId],
  );
  const carryStop = carry && carry.stop.lat != null && carry.stop.lng != null ? carry.stop : null;
  const fitStops = useMemo(
    () => (carryStop ? [...located, carryStop] : located),
    [located, carryStop],
  );

  const [poi, setPoi] = useState<{ placeId: string; lat: number; lng: number } | null>(null);

  return (
    <div className="relative h-full overflow-hidden rounded-xl border border-line shadow-card">
      <GMap
        mapId="TABIMATE_MAP"
        defaultCenter={
          located[0]
            ? { lat: located[0].lat!, lng: located[0].lng! }
            : { lat: 35.6812, lng: 139.7671 }
        }
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI={false}
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        clickableIcons
        onClick={(e) => {
          const placeId = (e.detail as { placeId?: string | null }).placeId;
          if (placeId && e.detail.latLng) {
            e.stop?.();
            setPoi({ placeId, lat: e.detail.latLng.lat, lng: e.detail.latLng.lng });
          } else {
            setPoi(null);
          }
        }}
      >
        <FitBounds stops={fitStops} dayId={activeDayId} />
        {carryStop && (
          <AdvancedMarker
            position={{ lat: carryStop.lat!, lng: carryStop.lng! }}
            zIndex={5}
            onClick={() => setSelectedStop(carryStop.id)}
          >
            <div
              className="flex size-7 items-center justify-center rounded-full border-2 border-white text-white shadow-lift"
              style={{ backgroundColor: "var(--tm-cat-lodging)" }}
              title={`${carryStop.name}(住宿)`}
            >
              <Bed weight="fill" className="size-3.5" />
            </div>
          </AdvancedMarker>
        )}
        {located.map((stop, i) => {
          const idx = stops.indexOf(stop);
          const meta = CATEGORY_META[stop.category];
          const selected = stop.id === selectedStopId;
          return (
            <AdvancedMarker
              key={stop.id}
              position={{ lat: stop.lat!, lng: stop.lng! }}
              zIndex={selected ? 100 : i}
              onClick={() => setSelectedStop(selected ? null : stop.id)}
            >
              <div
                className={cn(
                  "flex items-center justify-center rounded-full border-2 border-white font-display font-bold text-white shadow-lift transition-transform duration-150",
                  selected ? "size-9 scale-110 text-sm" : "size-7 text-xs",
                  changedStopIds.has(stop.id) && "animate-[tm-pop-in_0.4s_ease-out]",
                )}
                style={{ backgroundColor: meta.colorVar }}
                title={stop.name}
              >
                {idx + 1}
              </div>
            </AdvancedMarker>
          );
        })}
        {poi && <PoiCard poi={poi} onClose={() => setPoi(null)} />}
      </GMap>
    </div>
  );
}

function FitBounds({ stops, dayId }: { stops: Stop[]; dayId: string | null }) {
  const map = useMap();
  const lastDay = useRef<string | null>(null);
  useEffect(() => {
    if (!map || stops.length === 0) return;
    // 換天或初次:fit 全部;同天內編輯不打擾視角
    if (lastDay.current === dayId) return;
    lastDay.current = dayId;
    if (stops.length === 1) {
      map.panTo({ lat: stops[0].lat!, lng: stops[0].lng! });
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const s of stops) bounds.extend({ lat: s.lat!, lng: s.lng! });
    map.fitBounds(bounds, 56);
  }, [map, stops, dayId]);

  // 選點 → 平移過去
  const { selectedStopId } = useSelection();
  useEffect(() => {
    if (!map || !selectedStopId) return;
    const s = stops.find((x) => x.id === selectedStopId);
    if (s) map.panTo({ lat: s.lat!, lng: s.lng! });
  }, [map, selectedStopId, stops]);
  return null;
}


/** 點地圖上的 POI → 小卡 + 一鍵加入行程。 */
function PoiCard({
  poi,
  onClose,
}: {
  poi: { placeId: string; lat: number; lng: number };
  onClose: () => void;
}) {
  const { editOps } = useTrip();
  const { activeDayId } = useSelection();
  const [info, setInfo] = useState<{
    name: string;
    address: string;
    rating?: number;
    userRatingCount?: number;
    openingHours?: string[];
    types: string[];
    photoRefs: string[];
    website?: string;
    phone?: string;
    googleMapsUri?: string;
  } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setInfo(null);
    apiFetch<{ place: typeof info & { lat: number; lng: number } }>(
      `/api/google/place/${encodeURIComponent(poi.placeId)}`,
    )
      .then((d) => setInfo(d.place))
      .catch(onClose);
  }, [poi.placeId, onClose]);

  const add = async () => {
    if (!info || !activeDayId) return;
    setAdding(true);
    await editOps(
      [
        {
          op: "add_stop",
          tempId: "poi",
          dayId: activeDayId,
          name: info.name,
          category: guessCategory(info.types),
          placeId: poi.placeId,
          lat: poi.lat,
          lng: poi.lng,
          address: info.address,
        },
        // 已抓到的地點詳情(照片/營業時間/評分)一併寫入,詳情面板才有內容
        {
          op: "update_stop",
          stopId: "$poi",
          patch: {
            place: {
              rating: info.rating,
              userRatingCount: info.userRatingCount,
              openingHours: info.openingHours,
              photoRefs: info.photoRefs,
              website: info.website,
              phone: info.phone,
              googleMapsUri: info.googleMapsUri,
            },
          },
        },
      ],
      `新增 ${info.name}`,
    );
    onClose();
  };

  return (
    <AdvancedMarker position={{ lat: poi.lat, lng: poi.lng }} zIndex={200}>
      <div className="tm-pop-in w-56 -translate-y-2 rounded-lg border border-line bg-surface p-3 shadow-pop">
        <div className="flex items-start justify-between gap-2">
          {info ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{info.name}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-faint">{info.address}</p>
              {info.rating != null && (
                <p className="tm-num mt-0.5 text-[11px] text-sun-deep">★ {info.rating.toFixed(1)}</p>
              )}
            </div>
          ) : (
            <Spinner className="size-4" />
          )}
          <button
            aria-label="關閉"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="tm-focus shrink-0 rounded-sm p-0.5 text-ink-faint hover:bg-sunken"
          >
            <X className="size-3.5" />
          </button>
        </div>
        {info && (
          <Button
            size="sm"
            className="mt-2 w-full"
            loading={adding}
            onClick={(e) => {
              e.stopPropagation();
              add();
            }}
          >
            <Plus weight="bold" className="size-3.5" />
            加入行程
          </Button>
        )}
      </div>
    </AdvancedMarker>
  );
}

// ---- 無 key 降級:SVG 示意路線圖 ----

function MapFallback() {
  const { doc } = useTrip();
  const { activeDayId, selectedStopId, setSelectedStop } = useSelection();
  const stops = doc ? dayStopsOf(doc, activeDayId) : [];

  // 之字形排布
  const W = 720;
  const rowH = 92;
  const points = stops.map((s, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x = row % 2 === 0 ? 120 + col * 240 : W - 120 - col * 240;
    return { stop: s, x, y: 70 + row * rowH, n: i + 1 };
  });
  const H = Math.max(240, 70 + Math.ceil(stops.length / 3) * rowH);

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-[linear-gradient(160deg,#EEF7F7_0%,#FAF9F6_45%,#FFF4E4_100%)] shadow-card">
      <div className="tm-scroll flex-1 overflow-y-auto">
        {stops.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-faint">
            <MapTrifold weight="duotone" className="size-10" />
            <p className="text-sm">加入地點後,這裡會呈現當日路線</p>
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            {points.slice(0, -1).map((p, i) => {
              const q = points[i + 1];
              const midX = (p.x + q.x) / 2;
              return (
                <path
                  key={p.stop.id}
                  d={`M ${p.x} ${p.y} Q ${midX} ${(p.y + q.y) / 2 + 24} ${q.x} ${q.y}`}
                  fill="none"
                  stroke="var(--tm-ocean)"
                  strokeWidth={2.5}
                  strokeDasharray="1 8"
                  strokeLinecap="round"
                  opacity={0.55}
                />
              );
            })}
            {points.map((p) => {
              const meta = CATEGORY_META[p.stop.category];
              const selected = p.stop.id === selectedStopId;
              return (
                <g
                  key={p.stop.id}
                  transform={`translate(${p.x}, ${p.y})`}
                  className="cursor-pointer"
                  onClick={() => setSelectedStop(selected ? null : p.stop.id)}
                >
                  <circle
                    r={selected ? 22 : 17}
                    fill={meta.colorVar}
                    stroke="white"
                    strokeWidth={3}
                    style={{ transition: "r 0.15s" }}
                  />
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    fill="white"
                    fontSize={selected ? 15 : 12}
                    fontWeight={700}
                  >
                    {p.n}
                  </text>
                  <text
                    textAnchor="middle"
                    y={selected ? 40 : 34}
                    fill="var(--tm-ink)"
                    fontSize={12}
                    fontWeight={selected ? 700 : 500}
                  >
                    {p.stop.name.length > 12 ? p.stop.name.slice(0, 12) + "…" : p.stop.name}
                  </text>
                  {p.stop.startTime && (
                    <text
                      textAnchor="middle"
                      y={selected ? 54 : 48}
                      fill="var(--tm-ink-faint)"
                      fontSize={10}
                    >
                      {p.stop.startTime}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className="border-t border-line/60 bg-surface/70 px-3 py-1.5 text-center text-[11px] text-ink-faint backdrop-blur">
        示意路線圖 — 在後台設定 Google 地圖金鑰後,這裡會變成互動地圖與真實路線
      </p>
    </div>
  );
}
