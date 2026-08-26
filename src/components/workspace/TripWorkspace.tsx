"use client";

import { ArrowClockwise, AirplaneTilt,
  CaretDown,
  ChatCircle,
  ClockCounterClockwise,
  DotsThreeVertical,
  FilePdf,
  ListDashes,
  MapTrifold,
  SignOut,
  Ticket } from "@phosphor-icons/react";
import * as Popover from "@radix-ui/react-popover";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { useChat } from "@/lib/workspace/WorkspaceProvider";

import { apiFetch } from "@/lib/api";
import {
  usePresence,
  useRealtime,
  useSelection,
  useSession,
  useTrip,
} from "@/lib/workspace/WorkspaceProvider";
import { Avatar, AvatarStack, IconButton, ToastHost, TruncationTipHost } from "@/components/ui";
import { DayTabs } from "@/components/itinerary/DayTabs";
import { DayDrawer } from "@/components/itinerary/DayDrawer";
import { Timeline } from "@/components/itinerary/Timeline";
import { StopDetailPanel } from "@/components/itinerary/StopDetailPanel";
import { LegDetailPanel } from "@/components/itinerary/LegDetailPanel";
import { MapPanel } from "@/components/map/MapPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VersionsPanel } from "@/components/versions/VersionsPanel";
import { BookingOverview } from "@/components/booking/BookingOverview";

/**
 * 新版本偵測:以 /api/app-version(next build 的 BUILD_ID)為指紋;
 * WS 重連(部署重啟必經)、回到分頁、每 60 秒比對,變了就顯示重新載入橫幅。
 */
function UpdateBanner({ wsStatus }: { wsStatus: string }) {
  const [stale, setStale] = useState(false);
  const baseline = useRef<string | null>(null);
  const check = async () => {
    try {
      const res = await fetch("/api/app-version", { cache: "no-store" });
      const { version } = (await res.json()) as { version: string };
      if (!version || version === "dev") return;
      if (baseline.current == null) baseline.current = version;
      else if (version !== baseline.current) setStale(true);
    } catch {
      // 離線等:略過
    }
  };
  useEffect(() => {
    check();
    const t = setInterval(check, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (wsStatus === "open") check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsStatus]);
  if (!stale) return null;
  return (
    <button
      onClick={() => location.reload()}
      className="tm-focus tm-pop-in fixed top-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-medium text-white shadow-lift transition-transform hover:bg-coral-deep active:scale-95"
    >
      <ArrowClockwise weight="bold" className="size-4" />
      有新版本 — 點一下重新載入
    </button>
  );
}

/** 地點/交通詳細卡的統一出口:選了哪種就顯示哪張(桌面在地圖下、手機為行程頁底部抽屜)。 */
function DetailHost({ onShowMap }: { onShowMap?: () => void }) {
  const { selectedStopId, selectedLegId } = useSelection();
  if (selectedStopId) return <StopDetailPanel onShowMap={onShowMap} />;
  if (selectedLegId) return <LegDetailPanel onShowMap={onShowMap} />;
  return null;
}

/** 手機:詳細卡抽屜(只在行程頁)— 黑幕蓋住其餘畫面,點旁邊即關閉;卡內可跳地圖頁。 */
function MobileDetailDrawer({ onShowMap }: { onShowMap: () => void }) {
  const { selectedStopId, selectedLegId, setSelectedStop, setSelectedLeg } = useSelection();
  if (!selectedStopId && !selectedLegId) return null;
  const close = () => {
    setSelectedStop(null);
    setSelectedLeg(null);
  };
  return (
    <div className="fixed inset-0 z-40 hidden max-md:block">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[1px]" onMouseDown={close} />
      <div className="absolute inset-x-2 bottom-[calc(3.8rem+env(safe-area-inset-bottom))]">
        <DetailHost onShowMap={onShowMap} />
      </div>
    </div>
  );
}

export function TripWorkspace() {
  const { me, tripId, memberOf } = useSession();
  const { doc } = useTrip();
  const { roster } = usePresence();
  const { status } = useRealtime();
  const router = useRouter();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"timeline" | "map" | "chat">("timeline");
  // 手機切到地圖頁:地圖隱藏期間 pan/fit 無效,顯示後要求重新定位到目前選取
  useEffect(() => {
    if (mobileTab === "map") window.dispatchEvent(new Event("tm-locate"));
  }, [mobileTab]);
  // 聊天 @ 提及 / 稽核卡點擊 → 跳回行程頁定位該項目(手機)
  useEffect(() => {
    const fn = () => setMobileTab("timeline");
    window.addEventListener("tm-show-timeline", fn);
    return () => window.removeEventListener("tm-show-timeline", fn);
  }, []);
  const [dayDrawerOpen, setDayDrawerOpen] = useState(false);
  const { activeDayId } = useSelection();
  const agentCtx = useChat();
  const { store } = agentCtx;

  // 其他線上成員(自己固定顯示在最右的身分頭像,不重複出現在堆疊裡)
  const onlineMembers = roster
    .filter((r) => r.online && r.userId !== me.id)
    .map((r) => memberOf(r.userId));
  const needsBooking = (x: { bookingType: string; bookingStatus: string }) =>
    (x.bookingType === "reservation_required" || x.bookingType === "ticket_required") &&
    x.bookingStatus === "not_booked";
  const unbookedCount =
    (doc?.stops.filter(needsBooking).length ?? 0) + (doc?.legs.filter(needsBooking).length ?? 0);

  const logout = async () => {
    await apiFetch("/api/auth/logout", { json: {} });
    router.replace("/");
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg">
      <ToastHost />
      <TruncationTipHost />
      <UpdateBanner wsStatus={status} />

      {/* 頂欄 */}
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-1.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-coral text-white">
          <AirplaneTilt weight="fill" className="size-4.5" />
        </span>
        <div className="min-w-0 shrink-0">
          <h1 className="max-w-44 truncate font-display text-sm font-bold text-ink">
            {doc?.trip.title ?? "…"}
          </h1>
          {doc?.trip.destination && (
            <p className="text-[11px] text-ink-faint">{doc.trip.destination}</p>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-hidden max-md:hidden">
          <DayTabs />
        </div>

        {/* 手機:目前天 pill → 左側抽屜切換 */}
        <MobileDayPill onOpen={() => setDayDrawerOpen(true)} />

        <div className="flex shrink-0 items-center gap-1.5">
          {status !== "open" && (
            <span className="rounded-full bg-sun-wash px-2.5 py-1 text-[11px] font-medium text-sun-deep max-md:hidden">
              {status === "connecting" ? "連線中…" : "已斷線,重連中…"}
            </span>
          )}

          {/* 在線成員:點開名單 */}
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                aria-label="誰在線上"
                className="tm-focus flex items-center gap-1 rounded-full px-1 py-0.5 transition-colors hover:bg-sunken"
              >
                <AvatarStack users={onlineMembers} size="sm" max={4} />
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-leaf opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-leaf" />
                </span>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={8}
                collisionPadding={10}
                className="tm-pop-in z-40 w-52 rounded-xl border border-line bg-surface p-2 shadow-pop"
              >
                <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-ink-faint">
                  線上成員
                </p>
                <ul className="flex flex-col">
                  <li className="flex items-center gap-2 rounded-md px-2 py-1.5">
                    <Avatar user={me} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {me.name}
                    </span>
                    <span className="text-[11px] text-ink-faint">你</span>
                  </li>
                  {onlineMembers.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                      <Avatar user={m} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {m.name}
                      </span>
                      <span className="size-1.5 rounded-full bg-leaf" />
                    </li>
                  ))}
                </ul>
                {onlineMembers.length === 0 && (
                  <p className="px-2 pb-1 text-[12px] text-ink-faint">目前只有你在線上。</p>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {/* 桌面:動作 icons;手機:收進漢堡選單 */}
          <div className="flex items-center gap-1.5 max-md:hidden">
            <IconButton label="預約總覽" size="sm" onClick={() => setBookingOpen(true)} className="relative">
              <Ticket className="size-4.5" />
              {unbookedCount > 0 && (
                <span className="tm-num absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-alert text-[10px] font-semibold text-white">
                  {unbookedCount}
                </span>
              )}
            </IconButton>
            <IconButton label="版本歷史" size="sm" onClick={() => setVersionsOpen(true)}>
              <ClockCounterClockwise className="size-4.5" />
            </IconButton>
            <IconButton
              label="匯出 PDF"
              size="sm"
              onClick={() => window.open(`/trips/${tripId}/print`, "_blank", "noreferrer")}
            >
              <FilePdf className="size-4.5" />
            </IconButton>
            <Avatar user={me} size="sm" />
            <IconButton label="登出" size="sm" onClick={logout}>
              <SignOut className="size-4.5" />
            </IconButton>
          </div>

          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                aria-label="更多動作"
                className="tm-focus relative hidden size-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-sunken max-md:flex"
              >
                <DotsThreeVertical weight="bold" className="size-5" />
                {unbookedCount > 0 && (
                  <span className="absolute top-1 right-1 size-2 rounded-full bg-alert" />
                )}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={8}
                collisionPadding={10}
                className="tm-pop-in z-40 w-48 rounded-xl border border-line bg-surface p-1.5 shadow-pop"
              >
                {[
                  {
                    label: `預約總覽${unbookedCount > 0 ? `(${unbookedCount} 未訂)` : ""}`,
                    icon: Ticket,
                    onClick: () => setBookingOpen(true),
                  },
                  { label: "版本歷史", icon: ClockCounterClockwise, onClick: () => setVersionsOpen(true) },
                  {
                    label: "匯出 PDF",
                    icon: FilePdf,
                    onClick: () => window.open(`/trips/${tripId}/print`, "_blank", "noreferrer"),
                  },
                  { label: "登出", icon: SignOut, onClick: logout },
                ].map((item) => (
                  <Popover.Close key={item.label} asChild>
                    <button
                      onClick={item.onClick}
                      className="tm-focus flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-sunken"
                    >
                      <item.icon className="size-4.5 text-ink-soft" />
                      {item.label}
                    </button>
                  </Popover.Close>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </header>

      {/* 三欄工作區(桌機);行動版單欄 + 底部三 tab */}
      <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr_400px] max-xl:grid-cols-[320px_1fr_360px] max-lg:grid-cols-[300px_1fr] max-md:grid-cols-1">
        <aside
          className={cn(
            "tm-scroll min-h-0 overflow-y-auto border-r border-line p-2.5",
            "max-md:border-r-0",
            mobileTab !== "timeline" && "max-md:hidden",
          )}
        >
          <Timeline />
        </aside>

        <main
          className={cn(
            "flex min-h-0 flex-col gap-2.5 p-2.5",
            mobileTab !== "map" && "max-md:hidden",
          )}
        >
          <div className="min-h-0 flex-1">
            <MapPanel />
          </div>
          <div className="contents max-md:hidden">
            <DetailHost />
          </div>
        </main>

        <aside
          className={cn(
            "min-h-0 border-l border-line max-md:border-l-0",
            "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-[380px] max-lg:shadow-pop max-md:static max-md:w-auto max-md:shadow-none",
            // lg 以下:聊天為抽屜,僅 chat tab 或桌機顯示
            mobileTab !== "chat" && "max-lg:hidden",
          )}
        >
          <ChatPanel />
        </aside>
      </div>

      {/* 手機:地點/交通詳細=行程頁底部抽屜(黑幕點旁關閉;塔比頁不出現) */}
      {mobileTab === "timeline" && <MobileDetailDrawer onShowMap={() => setMobileTab("map")} />}
      {/* 手機:地圖頁點行程地點也出詳情卡 — 無黑幕、不擋地圖操作;地圖鈕=重新定位 */}
      {mobileTab === "map" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(3.8rem+env(safe-area-inset-bottom))] z-30 hidden px-2 max-md:block [&>section]:pointer-events-auto">
          <DetailHost onShowMap={() => window.dispatchEvent(new Event("tm-locate"))} />
        </div>
      )}

      {/* lg 以下:聊天抽屜浮動開關(帶 agent 活動脈動) */}
      <ChatFab
        active={mobileTab === "chat"}
        onClick={() => setMobileTab(mobileTab === "chat" ? "timeline" : "chat")}
      />

      {/* 行動版底部導覽 */}
      <nav className="hidden shrink-0 items-center border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] max-md:flex">
        {(
          [
            { key: "timeline", label: "行程", icon: ListDashes },
            { key: "map", label: "地圖", icon: MapTrifold },
            { key: "chat", label: "塔比", icon: ChatCircle },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMobileTab(tab.key)}
            className={cn(
              "tm-focus flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
              mobileTab === tab.key ? "font-medium text-coral-deep" : "text-ink-faint",
            )}
          >
            <tab.icon
              weight={mobileTab === tab.key ? "fill" : "regular"}
              className="size-5"
            />
            {tab.label}
          </button>
        ))}
      </nav>

      <DayDrawer open={dayDrawerOpen} onClose={() => setDayDrawerOpen(false)} />
      <VersionsPanel open={versionsOpen} onClose={() => setVersionsOpen(false)} />
      <BookingOverview open={bookingOpen} onClose={() => setBookingOpen(false)} />
    </div>
  );

  function MobileDayPill({ onOpen }: { onOpen: () => void }) {
    const days = [...(doc?.days ?? [])].sort((a, b) => a.position - b.position);
    const idx = days.findIndex((d) => d.id === activeDayId);
    return (
      <button
        onClick={onOpen}
        className="tm-focus mr-auto hidden shrink-0 items-center gap-1.5 rounded-full bg-coral px-3.5 py-1.5 text-white shadow-[0_2px_10px_-2px_rgb(255_93_71/0.55)] active:scale-[0.97] max-md:flex"
      >
        <span className="font-display text-sm font-semibold">Day {idx >= 0 ? idx + 1 : 1}</span>
        <CaretDown weight="bold" className="size-3.5" />
      </button>
    );
  }

  function ChatFab({ active, onClick }: { active: boolean; onClick: () => void }) {
    const phase = store.agentPhase;
    const fabName = agentCtx.agent.identity.name || "塔比";
    return (
      <button
        onClick={onClick}
        className={cn(
          "tm-focus fixed right-4 bottom-4 z-20 hidden items-center gap-2 rounded-full py-2.5 pr-4 pl-3 font-medium shadow-lift transition-transform active:scale-95 max-lg:flex max-md:hidden",
          active ? "bg-ink text-white" : "bg-ocean text-white",
        )}
      >
        <ChatCircle weight="fill" className="size-5" />
        <span className="text-sm">{fabName}</span>
        {phase !== "idle" && !active && (
          <span className="size-2 animate-pulse rounded-full bg-sun" />
        )}
      </button>
    );
  }
}
