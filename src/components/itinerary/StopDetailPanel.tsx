"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowSquareOut,
  CalendarCheck,
  Clock,
  Link as LinkIcon,
  MapPin,
  Phone,
  Star,
  Trash,
  X,
} from "@phosphor-icons/react";

import { CATEGORY_META } from "@/lib/categories";
import { carryOverLodging, isOvernightLodging, primaryLodgingOf } from "@/shared/conflicts";
import { cn } from "@/lib/cn";
import { STOP_CATEGORIES, type BookingStatus } from "@/shared/config";
import type { Stop } from "@/shared/types";
import {
  useSelection,
  useSession,
  useTrip,
} from "@/lib/workspace/WorkspaceProvider";
import { ConfirmDialog, Hint, ImageLightbox, SegmentedChips, Switch, Tag } from "@/components/ui";
import { BookingBadge, bookingWords, VerifyBadge } from "./badges";
import { TimeField } from "./TimeField";

export function StopDetailPanel() {
  const { doc, editOps } = useTrip();
  const { selectedStopId, setSelectedStop } = useSelection();
  const { googleReady } = useSession();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // 選中卡片時按倒退鍵/Delete → 開啟同一個刪除確認
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable], [role='dialog'], [data-radix-popper-content-wrapper]")) return;
      e.preventDefault();
      setConfirmDelete(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stop = doc?.stops.find((s) => s.id === selectedStopId);
  if (!doc || !stop) return null;
  const meta = CATEGORY_META[stop.category];
  const days = [...doc.days].sort((a, b) => a.position - b.position);
  const dayIndex = days.findIndex((d) => d.id === stop.dayId);

  // 開始時間的智慧預設:前一段交通抵達 > 前一站結束 > 前一站開始
  const sameDay = doc.stops
    .filter((s) => s.dayId === stop.dayId)
    .sort((a, b) => a.position - b.position);
  const prevStop = sameDay[sameDay.findIndex((s) => s.id === stop.id) - 1] ?? null;
  const prevLeg = prevStop ? doc.legs.find((l) => l.toStopId === stop.id) ?? null : null;
  const carry = !prevStop ? carryOverLodging(doc.days, doc.stops, stop.dayId) : null;
  const startDefault =
    prevLeg?.arrivalTime ??
    prevStop?.endTime ??
    prevStop?.startTime ??
    (carry?.isCheckoutDay && isOvernightLodging(carry.stop) ? carry.stop.endTime : null);

  // 住宿主卡(入住日第一張)才有連泊/入住退房設定;其餘 lodging 是回飯店輕量卡
  const isPrimaryLodging = primaryLodgingOf(doc.days, doc.stops, stop.dayId)?.id === stop.id;

  const patch = (p: Parameters<typeof buildPatchOp>[1], summary: string) =>
    editOps([buildPatchOp(stop.id, p)], summary);

  return (
    <section className="tm-pop-in tm-scroll flex max-h-[46%] flex-col overflow-y-auto rounded-xl border border-line bg-surface shadow-lift max-md:max-h-[56dvh]">
      {/* 照片:一個地點一張(照片額度以「每次抓圖」計費),點開看大圖 */}
      {googleReady && (stop.place?.photoRefs?.length ?? 0) > 0 && (
        <div className="p-2 pb-0">
          <button
            aria-label="看大圖"
            onClick={() => setLightboxIndex(0)}
            className="tm-focus group/photo relative block w-full overflow-hidden rounded-md"
          >
            <img
              src={`/api/google/photo?ref=${encodeURIComponent(stop.place!.photoRefs![0])}&w=400`}
              alt={stop.name}
              loading="lazy"
              className="h-32 w-full object-cover transition-transform duration-200 group-hover/photo:scale-[1.03]"
            />
            <span className="absolute inset-0 bg-ink/0 transition-colors group-hover/photo:bg-ink/15" />
          </button>
        </div>
      )}
      {lightboxIndex !== null && stop.place?.photoRefs?.[0] && (
        <ImageLightbox
          images={[
            {
              src: `/api/google/photo?ref=${encodeURIComponent(stop.place.photoRefs[0])}&w=1000`,
              alt: stop.name,
            },
          ]}
          name={stop.name}
          initialIndex={0}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <div className="flex flex-col gap-3 p-4">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: meta.colorVar }}
              >
                <meta.icon weight="fill" className="size-3.5" />
              </span>
              <h2 className="truncate font-display text-lg font-semibold text-ink">
                {stop.name}
              </h2>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <BookingBadge stop={stop} size="md" />
              <VerifyBadge stop={stop} size="md" />
              {stop.place?.rating != null && (
                <Tag tone="sun">
                  <Star weight="fill" className="size-3" />
                  <span className="tm-num">{stop.place.rating.toFixed(1)}</span>
                  {stop.place.userRatingCount != null && (
                    <span className="tm-num opacity-70">({stop.place.userRatingCount})</span>
                  )}
                </Tag>
              )}
            </div>
          </div>
          <button
            aria-label="關閉"
            onClick={() => setSelectedStop(null)}
            className="tm-focus shrink-0 rounded-sm p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* 時間 + 天 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Clock className="size-4 text-ink-faint" />
            <TimeField
              value={stop.startTime}
              onChange={(v) => patch({ startTime: v }, `調整 ${stop.name} 時間`)}
              defaultTime={startDefault}
            />
            <span className="text-ink-faint">
              {isPrimaryLodging ? "入住 →" : "-"}
            </span>
            <TimeField
              value={stop.endTime}
              onChange={(v) => patch({ endTime: v }, `調整 ${stop.name} 時間`)}
              defaultTime={isPrimaryLodging ? null : stop.startTime}
              defaultLabel={null}
              placeholder={isPrimaryLodging ? "退房" : "--:--"}
            />
            {isPrimaryLodging && (
              <span className="text-[11px] text-ink-faint">
                退房時間(隔天早上),會顯示在隔天的續住列
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isPrimaryLodging ? (
              <>
                {days.map((d, i) => {
                  const nights = Math.max(1, stop.nights ?? 1);
                  const active = i >= dayIndex && i < dayIndex + nights;
                  return (
                    <Hint key={d.id} tip={active && i === dayIndex ? "入住日" : `點選 = 住到 Day ${i + 1} 晚上`}>
                      <button
                        onClick={() => {
                          if (i >= dayIndex) {
                            // 住到第 i 天晚上
                            patch({ nights: i - dayIndex + 1 }, `${stop.name} 改為住 ${i - dayIndex + 1} 晚`);
                          } else {
                            // 點更早的天 = 入住日提前,退房晚保持
                            const lastNight = dayIndex + nights - 1;
                            editOps(
                              [
                                { op: "move_stop", stopId: stop.id, toDayId: d.id, position: 999 },
                                {
                                  op: "update_stop",
                                  stopId: stop.id,
                                  patch: { nights: lastNight - i + 1 },
                                },
                              ],
                              `${stop.name} 入住日改為 Day ${i + 1}`,
                            );
                          }
                        }}
                        className={cn(
                          "tm-focus rounded-full px-2 py-0.5 text-xs transition-colors",
                          active
                            ? "bg-cat-lodging text-white"
                            : "bg-sunken text-ink-soft hover:bg-cat-lodging/15 hover:text-cat-lodging",
                        )}
                      >
                        D{i + 1}
                      </button>
                    </Hint>
                  );
                })}
                <span className="ml-1 text-[11px] text-ink-faint">
                  住 {Math.max(1, stop.nights ?? 1)} 晚(點選住到哪一晚)
                </span>
              </>
            ) : (
              days.map((d, i) => (
                <button
                  key={d.id}
                  onClick={() =>
                    d.id !== stop.dayId &&
                    editOps(
                      [{ op: "move_stop", stopId: stop.id, toDayId: d.id, position: 999 }],
                      `把 ${stop.name} 移到 Day ${i + 1}`,
                    )
                  }
                  className={cn(
                    "tm-focus rounded-full px-2 py-0.5 text-xs transition-colors",
                    i === dayIndex
                      ? "bg-coral text-white"
                      : "bg-sunken text-ink-soft hover:bg-coral-wash hover:text-coral-deep",
                  )}
                >
                  D{i + 1}
                </button>
              ))
            )}
          </div>
        </div>

        {/* 分類 */}
        <SegmentedChips
          size="sm"
          options={STOP_CATEGORIES.map((c) => {
            const m = CATEGORY_META[c];
            const Icon = m.icon;
            return {
              value: c,
              label: m.label,
              icon: <Icon weight="duotone" className="size-3.5" style={{ color: m.colorVar }} />,
            };
          })}
          value={stop.category}
          onChange={(c) => patch({ category: c }, `調整 ${stop.name} 分類`)}
        />

        {/* 地址/連結 */}
        {(stop.address || stop.place?.phone || stop.place?.website || stop.place?.googleMapsUri) && (
          <div className="flex flex-col gap-1 text-[13px] text-ink-soft">
            {stop.address && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0 text-ink-faint" />
                {stop.address}
              </span>
            )}
            {stop.place?.phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="size-3.5 shrink-0 text-ink-faint" />
                <span className="tm-num">{stop.place.phone}</span>
              </span>
            )}
            <span className="flex items-center gap-3">
              {stop.place?.website && (
                <a
                  href={stop.place.website}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-ocean-deep hover:underline"
                >
                  <LinkIcon className="size-3.5" />
                  官網
                </a>
              )}
              {stop.place?.googleMapsUri && (
                <a
                  href={stop.place.googleMapsUri}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-ocean-deep hover:underline"
                >
                  <ArrowSquareOut className="size-3.5" />
                  在 Google 地圖開啟
                </a>
              )}
            </span>
          </div>
        )}

        {/* 營業時間 + 查證來源 */}
        {(stop.place?.openingHours?.length ?? 0) > 0 && (
          <div className="rounded-lg bg-sunken p-3">
            <p className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-soft">
              營業時間
              <VerifyBadge stop={stop} />
            </p>
            <ul className="tm-num grid grid-cols-1 gap-0.5 text-xs text-ink-soft">
              {stop.place!.openingHours!.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {stop.verifySources.length > 0 && (
              <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-line/70 pt-2 text-[11px]">
                <span className="font-medium text-ink-faint">查證來源</span>
                {stop.verifySources.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ocean-deep hover:underline"
                  >
                    ↗ {s.title}
                  </a>
                ))}
              </p>
            )}
          </div>
        )}

        {/* 已查證卻沒留下來源(舊版寫入):明講並引導補查,不默默隱藏 */}
        {stop.verifyStatus !== "unverified" && stop.verifySources.length === 0 && (
          <p className="rounded-lg bg-sun-wash/60 px-3 py-2 text-[12px] text-sun-deep">
            這筆查證沒有留下來源(舊版寫入)。可以跟塔比說「重新查證{stop.name}」補上來源。
          </p>
        )}

        {/* 沒有營業時間資料的地點(路口、街區、航廈…):查證來源獨立呈現,不然會看不到 */}
        {(stop.place?.openingHours?.length ?? 0) === 0 && stop.verifySources.length > 0 && (
          <div className="rounded-lg bg-sunken p-3">
            <p className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-soft">
              查證來源
              <VerifyBadge stop={stop} />
            </p>
            <p className="flex flex-wrap gap-2 text-[11px]">
              {stop.verifySources.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ocean-deep hover:underline"
                >
                  ↗ {s.title}
                </a>
              ))}
            </p>
          </div>
        )}

        <BookingSection stop={stop} />

        {stop.lat != null && (
          <Hint tip={"打開後,地圖總覽的縮放範圍不再遷就這個點\n(適合很遠的機場/車站;地圖上仍會顯示它的編號)"}>
            <div className="flex items-center justify-between rounded-lg bg-sunken px-3 py-2">
              <span className="text-xs text-ink-soft">不納入地圖視野(仍顯示標記)</span>
              <Switch
                checked={stop.excludeFromFit}
                onChange={(v) =>
                  patch({ excludeFromFit: v }, `${stop.name} ${v ? "退出" : "納入"}地圖視野計算`)
                }
              />
            </div>
          </Hint>
        )}

        <NotesEditor stop={stop} />

        <div className="flex justify-end">
          <button
            onClick={() => setConfirmDelete(true)}
            className="tm-focus flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-alert-wash hover:text-alert"
          >
            <Trash className="size-3.5" />
            從行程移除
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`移除 ${stop.name}?`}
        description="移除後可以隨時從版本歷史還原。"
        confirmLabel="移除"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          setSelectedStop(null);
          editOps([{ op: "remove_stop", stopId: stop.id }], `移除 ${stop.name}`);
        }}
      />
    </section>
  );
}

function buildPatchOp(
  stopId: string,
  patch: Record<string, unknown>,
): { op: "update_stop"; stopId: string; patch: never } {
  return { op: "update_stop", stopId, patch: patch as never };
}

function BookingSection({ stop }: { stop: Stop }) {
  const { editOps } = useTrip();
  if (stop.bookingType === "none") return null;
  const b = stop.booking;
  const words = bookingWords(stop);

  const setStatus = (status: BookingStatus) =>
    editOps(
      [{ op: "update_stop", stopId: stop.id, patch: { bookingStatus: status } }],
      `${stop.name} 標記為${status === "booked" ? words.done : status === "unavailable" ? words.fail : words.todo}`,
    );

  const deadlineDays = b?.deadline
    ? Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="rounded-lg border border-sun/40 bg-sun-wash/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-sun-deep">
          <CalendarCheck weight="fill" className="size-4" />
          {stop.bookingType === "reservation_required" && "需要預約"}
          {stop.bookingType === "ticket_required" && "需要購票"}
          {stop.bookingType === "recommended" && "建議預約"}
          {stop.bookingType === "walk_in_queue" && "現場排隊"}
        </p>
        {stop.bookingType !== "walk_in_queue" && (
          <SegmentedChips
            size="sm"
            options={[
              { value: "not_booked" as const, label: words.todo },
              { value: "booked" as const, label: `${words.done} ✓` },
              { value: "unavailable" as const, label: words.fail },
            ]}
            value={stop.bookingStatus}
            onChange={setStatus}
          />
        )}
      </div>
      {(b?.note || b?.platform || b?.deadline || b?.confirmationCode || b?.price) && (
        <div className="mt-2 flex flex-col gap-1 text-xs text-ink-soft">
          {b.note && <p>{b.note}</p>}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {b.platform && <span>平台:{b.platform}</span>}
            {b.price && <span className="tm-num">票價:{b.price}</span>}
            {b.confirmationCode && (
              <span className="tm-num">確認編號:{b.confirmationCode}</span>
            )}
            {b.deadline && (
              <span
                className={cn(
                  "tm-num",
                  deadlineDays != null && deadlineDays <= 7 && "font-semibold text-alert",
                )}
              >
                截止:{b.deadline}
                {deadlineDays != null && deadlineDays >= 0 && `(剩 ${deadlineDays} 天)`}
              </span>
            )}
          </p>
        </div>
      )}
      {b?.url && (
        <a
          href={b.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 rounded-md bg-sun px-3 py-1.5 text-xs font-medium text-white transition-transform hover:brightness-105 active:scale-[0.97]"
        >
          <ArrowSquareOut weight="bold" className="size-3.5" />
          前往預約
        </a>
      )}
    </div>
  );
}

function NotesEditor({ stop }: { stop: Stop }) {
  const { editOps } = useTrip();
  const [text, setText] = useState(stop.notes);
  const stopIdRef = useRef(stop.id);

  // 換選不同 stop 時同步
  useEffect(() => {
    if (stopIdRef.current !== stop.id) {
      stopIdRef.current = stop.id;
      setText(stop.notes);
    }
  }, [stop.id, stop.notes]);

  const save = () => {
    if (text === stop.notes) return;
    editOps(
      [{ op: "update_stop", stopId: stop.id, patch: { notes: text } }],
      `更新 ${stop.name} 備註`,
    );
  };

  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      placeholder="備註(想吃的、注意事項…)"
      rows={2}
      className="tm-focus tm-scroll w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus-visible:border-ocean focus-visible:ring-2 focus-visible:ring-ocean/25 focus-visible:outline-none"
    />
  );
}
