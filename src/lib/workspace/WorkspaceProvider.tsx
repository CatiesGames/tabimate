"use client";

// 工作區狀態骨幹:session / 行程文件 / 選取 / presence / 聊天 / 連線。
// Server 權威 + 樂觀套用(共用 shared/changeset 引擎)+ itin_changed 全量 refetch 對帳。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { applyOperations, type Operation } from "@/shared/changeset";
import { AGENT_USER_ID } from "@/shared/config";
import type {
  ChatMessage,
  Day,
  Itinerary,
  Leg,
  Proposal,
  PublicUser,
  Stop,
} from "@/shared/types";
import { apiFetch, ApiError } from "@/lib/api";
import { RtConnection, type RtEvent, type RtStatus } from "@/lib/realtime/connection";
import { toast } from "@/components/ui";
import { ChatStore } from "./chatStore";

export type Member = { id: string; name: string; color: string };

export type PresenceRow = {
  userId: string;
  online: boolean;
  viewing: { dayId?: string; stopId?: string } | null;
};

export type AgentInfo = {
  available: boolean;
  model: string;
  queue: Array<{ messageId: string; userId: string; position: number }>;
  running: { messageId: string; requestedByUserId: string } | null;
};

type SessionCtx = {
  me: PublicUser;
  tripId: string;
  members: Member[];
  memberOf: (id: string | null) => Member;
  googleReady: boolean;
  mapsBrowserKey: string | null;
};

type TripCtx = {
  doc: Itinerary | null;
  /** 最近一次 itin_changed 的受影響 stopIds(flash 高亮用)。 */
  changedStopIds: Set<string>;
  editOps: (ops: Operation[], summary?: string) => Promise<boolean>;
  refetch: () => Promise<void>;
};

type SelectionCtx = {
  activeDayId: string | null;
  selectedStopId: string | null;
  setActiveDay: (dayId: string) => void;
  setSelectedStop: (stopId: string | null) => void;
};

type PresenceCtx = {
  roster: PresenceRow[];
  viewersOfDay: (dayId: string) => Member[];
  viewersOfStop: (stopId: string) => Member[];
};

type RealtimeCtx = { status: RtStatus };

type ProposalsCtx = {
  pending: Proposal[];
  confirm: (id: string) => Promise<void>;
  reject: (id: string, note?: string) => Promise<void>;
};

const Session = createContext<SessionCtx | null>(null);
const Trip = createContext<TripCtx | null>(null);
const Selection = createContext<SelectionCtx | null>(null);
const Presence = createContext<PresenceCtx | null>(null);
const Realtime = createContext<RealtimeCtx | null>(null);
const Proposals = createContext<ProposalsCtx | null>(null);
const Chat = createContext<{ store: ChatStore; agent: AgentInfo } | null>(null);

export const useSession = () => useContext(Session)!;
export const useTrip = () => useContext(Trip)!;
export const useSelection = () => useContext(Selection)!;
export const usePresence = () => useContext(Presence)!;
export const useRealtime = () => useContext(Realtime)!;
export const useProposals = () => useContext(Proposals)!;
export const useChat = () => useContext(Chat)!;

const AGENT_MEMBER: Member = { id: AGENT_USER_ID, name: "塔比", color: "#0E9BA4" };

export function WorkspaceProvider({
  tripId,
  children,
}: {
  tripId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [doc, setDoc] = useState<Itinerary | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [mapsBrowserKey, setMapsBrowserKey] = useState<string | null>(null);
  const [roster, setRoster] = useState<PresenceRow[]>([]);
  const [status, setStatus] = useState<RtStatus>("connecting");
  const [pending, setPending] = useState<Proposal[]>([]);
  const [agent, setAgent] = useState<AgentInfo>({
    available: false,
    model: "",
    queue: [],
    running: null,
  });
  const [changedStopIds, setChangedStopIds] = useState<Set<string>>(new Set());
  const [activeDayId, setActiveDayId] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  const chatStoreRef = useRef<ChatStore>(null as never);
  if (!chatStoreRef.current) chatStoreRef.current = new ChatStore();
  const connRef = useRef<RtConnection | null>(null);
  const docRef = useRef<Itinerary | null>(null);
  docRef.current = doc;
  const membersRef = useRef<Member[]>([]);
  membersRef.current = members;
  const meRef = useRef<PublicUser | null>(null);
  meRef.current = me;

  const memberOf = useCallback((id: string | null): Member => {
    if (id === AGENT_USER_ID) return AGENT_MEMBER;
    return (
      membersRef.current.find((m) => m.id === id) ?? {
        id: id ?? "?",
        name: "成員",
        color: "#8A8578",
      }
    );
  }, []);

  const refetch = useCallback(async () => {
    const data = await apiFetch<Itinerary>(`/api/trips/${tripId}/itinerary`);
    setDoc(data);
  }, [tripId]);

  const refetchChatSince = useCallback(
    async (sinceSeq: number) => {
      const data = await apiFetch<{ messages: ChatMessage[] }>(
        `/api/trips/${tripId}/chat?sinceSeq=${sinceSeq}&limit=500`,
      );
      chatStoreRef.current.loadHistory(data.messages);
    },
    [tripId],
  );

  // ---- 初始載入 ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await apiFetch<{ user: PublicUser }>("/api/auth/me");
        if (cancelled) return;
        if (meRes.user.tripId !== tripId) {
          router.replace(`/trips/${meRes.user.tripId}`);
          return;
        }
        setMe(meRes.user);
        const [membersRes, itin] = await Promise.all([
          apiFetch<{ members: Member[] }>(`/api/trips/${tripId}/members`),
          apiFetch<Itinerary>(`/api/trips/${tripId}/itinerary`),
        ]);
        if (cancelled) return;
        setMembers(membersRes.members);
        setDoc(itin);
        refetchChatSince(0);
      } catch (e) {
        // 未登入 → 帶著目標行程回登入頁(後台直達連結/隱藏行程也能順利登入)
        if (e instanceof ApiError && e.status === 401) {
          router.replace(`/?trip=${tripId}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, router, refetchChatSince]);

  // ---- WS ----
  useEffect(() => {
    if (!me) return;
    const conn = new RtConnection(tripId);
    connRef.current = conn;
    const store = chatStoreRef.current;

    const offStatus = conn.onStatus(setStatus);
    const offEvent = conn.onEvent((e: RtEvent) => {
      switch (e.type) {
        case "sub_ok": {
          const rev = e.itineraryRev as number;
          if (!docRef.current || docRef.current.trip.itineraryRev !== rev) refetch();
          setPending(e.pendingProposals as Proposal[]);
          setRoster((e.presenceRoster as PresenceRow[]) ?? []);
          setGoogleReady(!!e.googleReady);
          setMapsBrowserKey((e.mapsBrowserKey as string) ?? null);
          const a = e.agent as {
            available: boolean;
            model: string;
            queue: AgentInfo["queue"];
            running: AgentInfo["running"];
            activeStream: { messageId: string; partialText: string } | null;
          };
          setAgent({
            available: a.available,
            model: a.model,
            queue: a.queue ?? [],
            running: a.running ?? null,
          });
          const latest = e.latestChatSeq as number;
          const localMax = Math.max(0, ...store.getOrdered().map((m) => m.seq));
          if (latest > localMax) refetchChatSince(localMax);
          if (a.activeStream) {
            store.liveMessageId = a.activeStream.messageId;
            store.liveText = a.activeStream.partialText;
            store.setPhase("streaming");
          }
          break;
        }
        case "itin_changed": {
          refetch();
          const scope = e.scope as { stopIds: string[] };
          setChangedStopIds(new Set(scope?.stopIds ?? []));
          const actor = e.actor as { userId: string | null; viaAgent: boolean };
          const isSelf = actor.userId === meRef.current?.id && !actor.viaAgent;
          if (!isSelf) {
            const who = actor.viaAgent
              ? actor.userId
                ? `塔比(${memberOf(actor.userId).name} 發起)`
                : "塔比"
              : memberOf(actor.userId).name;
            toast(`${who} ${e.summary as string}`, {
              actor: actor.viaAgent
                ? { ...AGENT_MEMBER }
                : memberOf(actor.userId),
            });
          }
          break;
        }
        case "itin_meta_changed":
          refetch();
          break;
        case "presence":
          setRoster((e.roster as PresenceRow[]) ?? []);
          break;
        case "proposal_new": {
          const p = e.proposal as Proposal;
          setPending((prev) => [...prev.filter((x) => x.id !== p.id), p]);
          break;
        }
        case "proposal_resolved": {
          const id = e.proposalId as string;
          setPending((prev) => prev.filter((x) => x.id !== id));
          break;
        }
        case "config_changed":
          setGoogleReady(!!e.googleReady);
          setMapsBrowserKey((e.mapsBrowserKey as string) ?? null);
          break;
        case "chat_queued": {
          store.upsert(e.message as ChatMessage);
          store.setPhase("queued");
          setAgent((prev) => ({ ...prev, queue: (e.queue as AgentInfo["queue"]) ?? prev.queue }));
          break;
        }
        case "chat_started": {
          // 該則使用者訊息已開始處理 → 摘掉「排隊中」標記
          const userMsgId = e.userMessageId as string | undefined;
          if (userMsgId) {
            const um = store.get(userMsgId);
            if (um && um.status === "queued") store.upsert({ ...um, status: "complete" });
          }
          store.onStarted(e.message as ChatMessage);
          store.setPhase("thinking");
          setAgent((prev) => ({
            ...prev,
            queue: (e.queue as AgentInfo["queue"]) ?? prev.queue,
            running: {
              messageId: (e.message as ChatMessage).id,
              requestedByUserId: (e.message as ChatMessage).userId ?? "",
            },
          }));
          break;
        }
        case "chat_message":
          store.upsert(e.message as ChatMessage);
          break;
        case "chat_delta":
          store.onDelta(e.messageId as string, e.text as string);
          break;
        case "chat_block":
          store.onBlock(e.messageId as string, e.idx as number, e.block as never);
          break;
        case "agent_status": {
          const s = e.state as string;
          if (s === "idle") store.setPhase("idle");
          else if (s === "stopping") {
            store.stoppingBy = (e.byUserId as string) ?? null;
            store.setPhase("stopping");
          } else store.setPhase(s as never, (e.label as string) ?? "");
          break;
        }
        case "chat_done":
          store.onFinished(e.messageId as string, "complete");
          setAgent((prev) => ({ ...prev, running: null }));
          break;
        case "chat_stopped": {
          store.onFinished(e.messageId as string, "stopped");
          setAgent((prev) => ({ ...prev, running: null }));
          const by = memberOf((e.byUserId as string) ?? null);
          if (e.byUserId !== meRef.current?.id) {
            toast(`${by.name} 停止了塔比的回覆`, { actor: by });
          }
          break;
        }
        case "chat_error":
          store.onFinished(e.messageId as string, "error", e.error as string);
          setAgent((prev) => ({ ...prev, running: null }));
          break;
        case "chat_cancelled": {
          const msg = store.get(e.messageId as string);
          if (msg) store.upsert({ ...msg, status: "stopped" });
          setAgent((prev) => ({ ...prev, queue: (e.queue as AgentInfo["queue"]) ?? prev.queue }));
          break;
        }
        case "queue":
          setAgent((prev) => ({ ...prev, queue: (e.queue as AgentInfo["queue"]) ?? [] }));
          break;
      }
    });

    conn.connect();
    return () => {
      offStatus();
      offEvent();
      conn.close();
      connRef.current = null;
    };
  }, [me, tripId, refetch, refetchChatSince, memberOf, router]);

  // 分頁標題跟著行程名
  useEffect(() => {
    if (doc?.trip.title) document.title = `${doc.trip.title} · tabimate`;
  }, [doc?.trip.title]);

  // flash 高亮 800ms 後清掉
  useEffect(() => {
    if (changedStopIds.size === 0) return;
    const t = setTimeout(() => setChangedStopIds(new Set()), 900);
    return () => clearTimeout(t);
  }, [changedStopIds]);

  // 預設選第一天;天被刪掉時修正
  useEffect(() => {
    if (!doc) return;
    const days = [...doc.days].sort((a, b) => a.position - b.position);
    if (!activeDayId || !days.some((d) => d.id === activeDayId)) {
      setActiveDayId(days[0]?.id ?? null);
    }
    if (selectedStopId && !doc.stops.some((s) => s.id === selectedStopId)) {
      setSelectedStopId(null);
    }
  }, [doc, activeDayId, selectedStopId]);

  // presence 上報(節流 1/s)
  const lastSent = useRef(0);
  const pendingViewing = useRef<{ dayId?: string; stopId?: string } | null>(null);
  useEffect(() => {
    const viewing = {
      ...(activeDayId ? { dayId: activeDayId } : {}),
      ...(selectedStopId ? { stopId: selectedStopId } : {}),
    };
    pendingViewing.current = viewing;
    const send = () => {
      lastSent.current = Date.now();
      connRef.current?.send({ type: "presence", viewing: pendingViewing.current });
    };
    const elapsed = Date.now() - lastSent.current;
    if (elapsed > 1000) send();
    else {
      const t = setTimeout(send, 1000 - elapsed);
      return () => clearTimeout(t);
    }
  }, [activeDayId, selectedStopId, status]);

  // ---- 樂觀編輯 ----
  const editOps = useCallback(
    async (ops: Operation[], summary?: string): Promise<boolean> => {
      const current = docRef.current;
      if (current && meRef.current) {
        try {
          let tempCounter = 0;
          const applied = applyOperations(
            { trip: { title: current.trip.title, destination: current.trip.destination, startDate: current.trip.startDate }, days: current.days, stops: current.stops, legs: current.legs },
            ops,
            {
              tripId,
              actorUserId: meRef.current.id,
              now: Date.now(),
              newId: () => `optimistic_${++tempCounter}_${Math.random().toString(36).slice(2, 8)}`,
            },
          );
          setDoc({
            trip: current.trip,
            days: applied.doc.days as Day[],
            stops: applied.doc.stops as Stop[],
            legs: applied.doc.legs as Leg[],
          });
        } catch {
          // 樂觀套用失敗就等 server 裁決
        }
      }
      try {
        await apiFetch(`/api/trips/${tripId}/edit`, { json: { ops, summary } });
        return true;
      } catch (e) {
        await refetch();
        toast(e instanceof ApiError ? (e.message || "變更未儲存,已還原") : "變更未儲存,已還原", {
          tone: "error",
        });
        return false;
      }
    },
    [tripId, refetch],
  );

  // ---- proposals ----
  const confirmProposal = useCallback(async (id: string) => {
    await apiFetch(`/api/proposals/${id}/confirm`, { json: {} });
  }, []);
  const rejectProposal = useCallback(async (id: string, note?: string) => {
    await apiFetch(`/api/proposals/${id}/reject`, { json: { note } });
  }, []);

  const sessionValue = useMemo(
    () =>
      me
        ? { me, tripId, members, memberOf, googleReady, mapsBrowserKey }
        : null,
    [me, tripId, members, memberOf, googleReady, mapsBrowserKey],
  );

  const presenceValue = useMemo<PresenceCtx>(
    () => ({
      roster,
      viewersOfDay: (dayId: string) =>
        roster
          .filter((r) => r.viewing?.dayId === dayId && r.userId !== me?.id)
          .map((r) => memberOf(r.userId)),
      viewersOfStop: (stopId: string) =>
        roster
          .filter((r) => r.viewing?.stopId === stopId && r.userId !== me?.id)
          .map((r) => memberOf(r.userId)),
    }),
    [roster, memberOf, me],
  );

  const tripValue = useMemo<TripCtx>(
    () => ({ doc, changedStopIds, editOps, refetch }),
    [doc, changedStopIds, editOps, refetch],
  );

  const selectionValue = useMemo<SelectionCtx>(
    () => ({
      activeDayId,
      selectedStopId,
      setActiveDay: (dayId) => {
        setActiveDayId(dayId);
        setSelectedStopId(null);
      },
      setSelectedStop: setSelectedStopId,
    }),
    [activeDayId, selectedStopId],
  );

  const proposalsValue = useMemo<ProposalsCtx>(
    () => ({ pending, confirm: confirmProposal, reject: rejectProposal }),
    [pending, confirmProposal, rejectProposal],
  );

  const chatValue = useMemo(
    () => ({ store: chatStoreRef.current, agent }),
    [agent],
  );

  if (!sessionValue) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-bg">
        <span className="tm-skeleton size-10 rounded-full" />
      </main>
    );
  }

  return (
    <Session.Provider value={sessionValue}>
      <Realtime.Provider value={{ status }}>
        <Trip.Provider value={tripValue}>
          <Selection.Provider value={selectionValue}>
            <Presence.Provider value={presenceValue}>
              <Proposals.Provider value={proposalsValue}>
                <Chat.Provider value={chatValue}>{children}</Chat.Provider>
              </Proposals.Provider>
            </Presence.Provider>
          </Selection.Provider>
        </Trip.Provider>
      </Realtime.Provider>
    </Session.Provider>
  );
}
