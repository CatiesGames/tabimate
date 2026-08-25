"use client";

import {
  AirplaneTilt,
  CaretDown,
  ChatCircle,
  FilePdf,
  ClockCounterClockwise,
  ListDashes,
  MapTrifold,
  SignOut,
  Ticket,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { Avatar, AvatarStack, IconButton, ToastHost } from "@/components/ui";
import { DayTabs } from "@/components/itinerary/DayTabs";
import { DayDrawer } from "@/components/itinerary/DayDrawer";
import { Timeline } from "@/components/itinerary/Timeline";
import { StopDetailPanel } from "@/components/itinerary/StopDetailPanel";
import { MapPanel } from "@/components/map/MapPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VersionsPanel } from "@/components/versions/VersionsPanel";
import { BookingOverview } from "@/components/booking/BookingOverview";

export function TripWorkspace() {
  const { me, tripId, memberOf } = useSession();
  const { doc } = useTrip();
  const { roster } = usePresence();
  const { status } = useRealtime();
  const router = useRouter();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"timeline" | "map" | "chat">("timeline");
  const [dayDrawerOpen, setDayDrawerOpen] = useState(false);
  const { activeDayId } = useSelection();
  const { store } = useChat();

  // 其他線上成員(自己固定顯示在最右的身分頭像,不重複出現在堆疊裡)
  const onlineMembers = roster
    .filter((r) => r.online && r.userId !== me.id)
    .map((r) => memberOf(r.userId));
  const unbookedCount =
    doc?.stops.filter(
      (s) =>
        (s.bookingType === "reservation_required" || s.bookingType === "ticket_required") &&
        s.bookingStatus === "not_booked",
    ).length ?? 0;

  const logout = async () => {
    await apiFetch("/api/auth/logout", { json: {} });
    router.replace("/");
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-bg">
      <ToastHost />

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
            <span className="rounded-full bg-sun-wash px-2.5 py-1 text-[11px] font-medium text-sun-deep">
              {status === "connecting" ? "連線中…" : "已斷線,重連中…"}
            </span>
          )}
          <AvatarStack users={onlineMembers} size="sm" max={5} />
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
          <Avatar user={me} size="sm" className="max-md:hidden" />
          <IconButton label="登出" size="sm" onClick={logout}>
            <SignOut className="size-4.5" />
          </IconButton>
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
          <StopDetailPanel />
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
    return (
      <button
        onClick={onClick}
        className={cn(
          "tm-focus fixed right-4 bottom-4 z-20 hidden items-center gap-2 rounded-full py-2.5 pr-4 pl-3 font-medium shadow-lift transition-transform active:scale-95 max-lg:flex max-md:hidden",
          active ? "bg-ink text-white" : "bg-ocean text-white",
        )}
      >
        <ChatCircle weight="fill" className="size-5" />
        <span className="text-sm">塔比</span>
        {phase !== "idle" && !active && (
          <span className="size-2 animate-pulse rounded-full bg-sun" />
        )}
      </button>
    );
  }
}
