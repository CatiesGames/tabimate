"use client";

// 行程列印版:A4 圖文排版,瀏覽器「另存為 PDF」即得完整行程檔。
// 開啟後預覽內容,按右上「列印 / 存 PDF」再印(不自動彈列印對話框)。
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AirplaneTilt, ArrowLeft, Bed, CalendarCheck, Printer, SealCheck, Ticket, Warning } from "@phosphor-icons/react";

import { apiFetch, ApiError } from "@/lib/api";
import { CATEGORY_META, LEG_MODE_ICON, LEG_MODE_LABEL } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { dayDateLabel } from "@/lib/dates";
import { carryOverLodging, isOvernightLodging, primaryLodgingOf } from "@/shared/conflicts";
import type { CarryLeg, Day, Itinerary, Leg, Stop } from "@/shared/types";

type Member = { id: string; name: string; color: string };

export function PrintView({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<Itinerary | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [googleReady, setGoogleReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [itin, mem, g] = await Promise.all([
          apiFetch<Itinerary>(`/api/trips/${tripId}/itinerary`),
          apiFetch<{ members: Member[] }>(`/api/trips/${tripId}/members`),
          apiFetch<{ configured: boolean }>("/api/google/status").catch(() => ({
            configured: false,
          })),
        ]);
        setDoc(itin);
        setMembers(mem.members);
        setGoogleReady(g.configured);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace(`/?trip=${tripId}`);
        }
      }
    })();
  }, [tripId, router]);

  if (!doc) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center">
        <span className="tm-skeleton size-10 rounded-full" />
      </main>
    );
  }

  const days = [...doc.days].sort((a, b) => a.position - b.position);
  const legOf = (stopId: string): Leg | undefined =>
    doc.legs.find((l) => l.fromStopId === stopId);
  const stopById2 = new Map(doc.stops.map((s) => [s.id, s]));
  const bookings = [
    ...doc.stops
      .filter((s) => s.bookingType !== "none")
      .map((s) => ({ id: s.id, name: s.name, dayId: s.dayId, bookingType: s.bookingType, bookingStatus: s.bookingStatus, booking: s.booking })),
    ...doc.legs
      .filter((l) => l.bookingType !== "none")
      .map((l) => ({
        id: l.id,
        name: `${stopById2.get(l.fromStopId)?.name ?? "?"} → ${stopById2.get(l.toStopId)?.name ?? "?"}(交通)`,
        dayId: stopById2.get(l.fromStopId)?.dayId ?? "",
        bookingType: l.bookingType,
        bookingStatus: l.bookingStatus,
        booking: l.booking,
      })),
  ];
  const dayIndexOf = new Map(days.map((d, i) => [d.id, i]));

  return (
    <div className="mx-auto max-w-[780px] bg-white px-8 py-6 text-ink print:max-w-none print:px-0 print:py-0">
      {/* 螢幕工具列(不列印) */}
      <div className="mb-6 flex items-center gap-3 print:hidden">
        <button
          onClick={() => router.push(`/trips/${tripId}`)}
          className="tm-focus flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-sunken"
        >
          <ArrowLeft className="size-4" />
          返回行程
        </button>
        <span className="flex-1" />
        <span className="text-xs text-ink-faint">列印對話框中選「另存為 PDF」即可匯出</span>
        <button
          onClick={() => window.print()}
          className="tm-focus flex items-center gap-1.5 rounded-md bg-coral px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-coral-deep"
        >
          <Printer weight="fill" className="size-4" />
          列印 / 另存 PDF
        </button>
      </div>

      {/* 封面標頭 */}
      <header className="mb-6 rounded-2xl bg-coral p-6 text-white print:rounded-xl">
        <div className="flex items-center gap-3">
          <AirplaneTilt weight="fill" className="size-8" />
          <div>
            <h1 className="font-display text-2xl font-bold">{doc.trip.title}</h1>
            <p className="tm-num mt-0.5 text-sm opacity-90">
              {doc.trip.destination && `${doc.trip.destination} · `}
              {doc.trip.startDate &&
                `${doc.trip.startDate.replaceAll("-", "/")} 出發 · ${days.length} 天`}
              {" · "}
              {members.map((m) => m.name).join("、")}
            </p>
          </div>
        </div>
      </header>

      {/* 預約清單 */}
      {bookings.length > 0 && (
        <section className="mb-6 overflow-hidden rounded-xl border border-sun/50 break-inside-avoid">
          <p className="flex items-center gap-2 bg-sun-wash px-4 py-2 text-sm font-semibold text-sun-deep">
            <Ticket weight="fill" className="size-4" />
            出發前的預約與購票清單
          </p>
          <table className="w-full text-[12px]">
            <tbody>
              {bookings.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-1.5 font-medium whitespace-nowrap">
                    Day {(dayIndexOf.get(s.dayId) ?? 0) + 1}
                  </td>
                  <td className="px-2 py-1.5">{s.name}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {s.bookingType === "reservation_required" && "需預約"}
                    {s.bookingType === "ticket_required" && "需購票"}
                    {s.bookingType === "recommended" && "建議預約"}
                    {s.bookingType === "walk_in_queue" && "現場排隊"}
                  </td>
                  <td className="px-2 py-1.5">
                    {s.bookingStatus === "booked" ? (
                      <span className="font-medium text-leaf-deep">✓ 已預約</span>
                    ) : (
                      <span className="font-medium text-alert">未預約</span>
                    )}
                  </td>
                  <td className="max-w-48 truncate px-2 py-1.5 text-ink-soft">
                    {s.booking?.url && (
                      <span className="break-all">{s.booking.url}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 每日行程 */}
      {days.map((day, di) => {
        const stops = doc.stops
          .filter((s) => s.dayId === day.id)
          .sort((a, b) => a.position - b.position);
        const dateLabel = dayDateLabel(doc.trip.startDate, day.position);
        return (
          <section key={day.id} className={cn("mb-6", di > 0 && "print:break-before-page")}>
            <h2 className="mb-3 flex items-baseline gap-3 border-b-2 border-coral pb-1.5">
              <span className="font-display text-xl font-bold text-coral-deep">
                Day {di + 1}
              </span>
              {dateLabel && (
                <span className="tm-num text-sm text-ink-soft">{dateLabel}</span>
              )}
              {day.title && <span className="text-sm text-ink-soft">{day.title}</span>}
            </h2>

            {/* 當天地圖:編號 marker 依行程順序連線,一眼看出移動方向 */}
            {googleReady && stops.some((st) => st.lat != null && st.lng != null) && (
              <img
                src={`/api/google/staticmap?day=${day.id}`}
                alt={`Day ${di + 1} 地圖`}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
                className="mb-2 w-full rounded-lg border border-line object-cover"
                style={{ printColorAdjust: "exact" }}
              />
            )}
            {(() => {
              const carry = carryOverLodging(days, doc.stops, day.id);
              if (!carry) return null;
              return (
                <>
                  <CarryRowPrint carry={carry} day={day} edge="top" googleReady={googleReady} />
                  {day.lodgingMorningLeg && <CarryLegRow leg={day.lodgingMorningLeg} />}
                </>
              );
            })()}
            {stops.length === 0 && (
              <p className="text-sm text-ink-faint">(這天尚未安排)</p>
            )}

            {stops.map((stop, i) => {
              const leg = legOf(stop.id);
              const nextStop = stops[i + 1];
              return (
                <div key={stop.id}>
                  <StopRow stop={stop} index={i + 1} googleReady={googleReady} />
                  {nextStop && leg && <LegRow leg={leg} />}
                </div>
              );
            })}

            {(() => {
              const carry = carryOverLodging(days, doc.stops, day.id);
              // 尾列:續住中間天,或入住日先放了行李(住宿不在末位)
              const checkin = primaryLodgingOf(days, doc.stops, day.id);
              const midday =
                checkin && stops[stops.length - 1]?.id !== checkin.id ? checkin : null;
              const bottom =
                carry && !carry.isCheckoutDay
                  ? carry
                  : !carry && midday
                    ? { stop: midday, isCheckoutDay: false }
                    : null;
              if (!bottom) return null;
              return (
                <>
                  {day.lodgingEveningLeg && <CarryLegRow leg={day.lodgingEveningLeg} />}
                  <CarryRowPrint carry={bottom} day={day} edge="bottom" googleReady={googleReady} />
                </>
              );
            })()}
          </section>
        );
      })}

      <footer className="mt-8 border-t border-line pt-3 text-center text-[10px] text-ink-faint print:mt-4">
        由 tabimate 產生 · {new Date().toLocaleDateString("zh-TW")} · 營業時間與班次以出發前官方資訊為準
      </footer>
    </div>
  );
}

function StopRow({
  stop,
  index,
  googleReady,
}: {
  stop: Stop;
  index: number;
  googleReady: boolean;
}) {
  const meta = CATEGORY_META[stop.category];
  const Icon = meta.icon;
  const photo = googleReady ? stop.place?.photoRefs?.[0] : null;
  return (
    <div className="flex gap-3 border-b border-line py-2.5 break-inside-avoid">
      {/* 時間 + 序號 */}
      <div className="w-16 shrink-0 pt-0.5 text-right">
        {stop.startTime ? (
          <p className="tm-num text-[13px] leading-tight font-bold">{stop.startTime}</p>
        ) : (
          <p className="text-[13px] text-ink-faint">—</p>
        )}
        {stop.endTime && (
          <p className="tm-num text-[11px] text-ink-faint">~{stop.endTime}</p>
        )}
      </div>

      <span
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: meta.colorVar, printColorAdjust: "exact" }}
        title={meta.label}
      >
        <Icon weight="fill" className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[14px] leading-tight font-semibold">
          <span className="tm-num text-ink-faint">{index}.</span> {stop.name}
          <span className="text-[11px] font-normal text-ink-faint">{meta.label}</span>
          {stop.verifyStatus === "verified" && (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-normal text-leaf-deep">
              <SealCheck weight="fill" className="size-3" />
              已查證
            </span>
          )}
        </p>
        {stop.address && (
          <p className="mt-0.5 text-[11px] text-ink-soft">{stop.address}</p>
        )}
        {(stop.place?.openingHours?.length ?? 0) > 0 && (
          <p className="mt-0.5 text-[11px] text-ink-faint">
            營業:{summarizeHours(stop.place!.openingHours!)}
          </p>
        )}
        {stop.bookingType !== "none" && (
          <p className="mt-0.5 flex items-start gap-1 text-[11px]">
            {stop.bookingStatus === "booked" ? (
              <CalendarCheck weight="fill" className="mt-0.5 size-3 shrink-0 text-leaf-deep" />
            ) : (
              <Warning weight="fill" className="mt-0.5 size-3 shrink-0 text-alert" />
            )}
            <span className={stop.bookingStatus === "booked" ? "text-leaf-deep" : "text-alert"}>
              {stop.bookingStatus === "booked"
                ? `已預約${stop.booking?.confirmationCode ? `(${stop.booking.confirmationCode})` : ""}`
                : `${
                    stop.bookingType === "reservation_required"
                      ? "需預約"
                      : stop.bookingType === "ticket_required"
                        ? "需購票"
                        : stop.bookingType === "recommended"
                          ? "建議預約"
                          : "現場排隊"
                  }${stop.booking?.note ? ` — ${stop.booking.note}` : ""}`}
            </span>
          </p>
        )}
        {stop.notes && (
          <p className="mt-0.5 text-[11px] text-ink-soft">備註:{stop.notes}</p>
        )}
      </div>

      {photo && (
        <img
          src={`/api/google/photo?ref=${encodeURIComponent(photo)}&w=400`}
          alt={stop.name}
          className="h-24 w-36 shrink-0 rounded-lg object-cover"
          style={{ printColorAdjust: "exact" }}
        />
      )}
    </div>
  );
}

/** 續住錨點列(頭=昨晚住這/退房;尾=今晚回這裡續住),版面對齊 StopRow。 */
function CarryRowPrint({
  carry,
  day,
  edge,
  googleReady,
}: {
  carry: NonNullable<ReturnType<typeof carryOverLodging>>;
  day: Day;
  edge: "top" | "bottom";
  googleReady: boolean;
}) {
  const photo = googleReady ? carry.stop.place?.photoRefs?.[0] : null;
  const time =
    edge === "bottom"
      ? day.lodgingReturnTime
      : carry.isCheckoutDay
        ? isOvernightLodging(carry.stop)
          ? carry.stop.endTime
          : null
        : day.lodgingDepartTime;
  const label =
    edge === "bottom"
      ? "今晚回這裡住"
      : carry.isCheckoutDay
        ? "昨晚住這,今天退房"
        : "昨晚住這,出發展開今天的行程";
  const timeLabel = edge === "bottom" ? "回到" : carry.isCheckoutDay ? "退房" : "出發";
  return (
    <div className="flex gap-3 rounded-md border border-dashed border-line-strong bg-sunken/40 px-2 py-2 break-inside-avoid" style={{ printColorAdjust: "exact" }}>
      <div className="w-14 shrink-0 pt-0.5 text-right">
        {time ? (
          <p className="tm-num text-[13px] leading-tight font-bold">{time}</p>
        ) : (
          <p className="text-[13px] text-ink-faint">—</p>
        )}
        <p className="text-[10px] text-ink-faint">{timeLabel}</p>
      </div>
      <span
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: "var(--tm-cat-lodging)", printColorAdjust: "exact" }}
      >
        <Bed weight="fill" className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-tight font-semibold">{carry.stop.name}</p>
        <p className="mt-0.5 text-[11px] text-ink-soft">{label}</p>
      </div>
      {photo && (
        <img
          src={`/api/google/photo?ref=${encodeURIComponent(photo)}&w=400`}
          alt={carry.stop.name}
          className="h-20 w-32 shrink-0 rounded-lg object-cover"
          style={{ printColorAdjust: "exact" }}
        />
      )}
    </div>
  );
}

/** 住宿頭尾交通(存在 day 上)沿用 LegRow 呈現。 */
function CarryLegRow({ leg }: { leg: CarryLeg }) {
  return (
    <LegRow
      leg={{
        id: "carry",
        tripId: "",
        fromStopId: "",
        toStopId: "",
        distanceM: null,
        needsReview: false,
        bookingType: "none" as const,
        bookingStatus: "not_booked" as const,
        booking: null,
        updatedAt: 0,
        ...leg,
      }}
    />
  );
}

function LegRow({ leg }: { leg: Leg }) {
  const Icon = LEG_MODE_ICON[leg.mode];
  const steps = leg.transit?.steps?.filter((s) => s.line) ?? [];
  return (
    <div className="flex items-center gap-2 py-1 pl-20 text-[11px] text-ink-soft break-inside-avoid">
      <Icon weight="fill" className="size-3.5 shrink-0 text-ocean" style={{ printColorAdjust: "exact" }} />
      <span className="font-medium">{LEG_MODE_LABEL[leg.mode]}</span>
      {steps.length > 0 ? (
        <span>
          {steps
            .map(
              (s) =>
                `${s.line}${s.departureTime && s.arrivalTime ? `(${s.departureTime}→${s.arrivalTime})` : ""}`,
            )
            .join(" → ")}
        </span>
      ) : (
        leg.transit?.summary && <span>{leg.transit.summary}</span>
      )}
      {!steps.length && leg.departureTime && leg.arrivalTime && (
        <span className="tm-num">
          {leg.departureTime}→{leg.arrivalTime}
        </span>
      )}
      {leg.durationMin != null && <span className="tm-num">{leg.durationMin} 分</span>}
      {leg.transit?.fare && <span className="tm-num">{leg.transit.fare}</span>}
      {leg.notes && <span>·{leg.notes}</span>}
    </div>
  );
}

/** 營業時間壓縮:每天相同 → 「每日 10:00-22:00」;否則列出各天(短格式)。 */
function summarizeHours(lines: string[]): string {
  const times = lines.map((l) => l.replace(/^星期[一二三四五六日][::]\s*/, "").trim());
  if (new Set(times).size === 1) return `每日 ${times[0]}`;
  return lines.map((l) => l.replace("星期", "")).join(";");
}
