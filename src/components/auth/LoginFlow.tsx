"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AirplaneTilt,
  ArrowLeft,
  CalendarBlank,
  MapPin,
  Users,
} from "@phosphor-icons/react";

import { apiFetch, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Avatar, Button, Input, Skeleton } from "@/components/ui";

type TripCard = {
  id: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  userCount: number;
  dayCount: number;
};

type PickUser = { id: string; name: string; color: string };

type Step =
  | { kind: "trips" }
  | { kind: "users"; trip: TripCard }
  | { kind: "password"; trip: TripCard; user: PickUser };

function formatDate(d: string | null): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return `${y}/${Number(m)}/${Number(day)}`;
}

export function LoginFlow() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripCard[] | null>(null);
  const [users, setUsers] = useState<PickUser[] | null>(null);
  const [step, setStep] = useState<Step>({ kind: "trips" });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 已登入直接進工作區
    apiFetch<{ user: { tripId: string } }>("/api/auth/me")
      .then((me) => router.replace(`/trips/${me.user.tripId}`))
      .catch(() => {
        // 直達連結(/?trip=xxx):跳過行程選擇,直接進該行程的成員頭像頁
        // (隱藏中的內部測試行程也走這條路)
        const tripId = new URLSearchParams(window.location.search).get("trip");
        if (tripId) {
          apiFetch<{ trip: TripCard }>(`/api/auth/trips/${tripId}`)
            .then((d) => {
              setTrips([d.trip]);
              pickTripRef.current(d.trip);
            })
            .catch(() => loadTrips());
        } else {
          loadTrips();
        }
        function loadTrips() {
          apiFetch<{ trips: TripCard[] }>("/api/auth/trips")
            .then((d) => setTrips(d.trips))
            .catch(() => setTrips([]));
        }
      });
  }, [router]);

  const pickTrip = async (trip: TripCard) => {
    setStep({ kind: "users", trip });
    setUsers(null);
    const d = await apiFetch<{ users: PickUser[] }>(`/api/auth/trips/${trip.id}/users`);
    setUsers(d.users);
  };
  const pickTripRef = useRef(pickTrip);
  pickTripRef.current = pickTrip;

  const pickUser = (trip: TripCard, user: PickUser) => {
    setStep({ kind: "password", trip, user });
    setPassword("");
    setError(null);
    setTimeout(() => pwRef.current?.focus(), 50);
  };

  const submit = async () => {
    if (step.kind !== "password" || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/login", {
        json: { userId: step.user.id, password },
      });
      router.replace(`/trips/${step.trip.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "密碼不正確" : "登入失敗,請再試一次");
      setBusy(false);
      pwRef.current?.select();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStep((s) =>
          s.kind === "password"
            ? { kind: "users", trip: s.trip }
            : s.kind === "users"
              ? { kind: "trips" }
              : s,
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 py-12">
      <header className="mb-10 flex flex-col items-center gap-3">
        <span className="flex size-14 items-center justify-center rounded-xl bg-coral text-white shadow-lift">
          <AirplaneTilt weight="fill" className="size-8" />
        </span>
        <h1 className="font-display text-3xl font-bold tracking-tight">tabimate</h1>
        <p className="text-sm text-ink-soft">
          {step.kind === "trips" && "選擇你的行程"}
          {step.kind === "users" && `${step.trip.title} · 你是哪一位?`}
          {step.kind === "password" && `${step.user.name},輸入密碼`}
        </p>
      </header>

      {step.kind === "trips" && (
        <section className="tm-pop-in grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          {trips === null &&
            [0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
          {trips?.length === 0 && (
            <div className="col-span-full rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink-soft">
              還沒有任何行程。請管理員到 /admin 建立行程與成員。
            </div>
          )}
          {trips?.map((trip) => (
            <button
              key={trip.id}
              onClick={() => pickTrip(trip)}
              className="tm-focus group flex flex-col gap-3 rounded-xl border border-line bg-surface p-6 text-left shadow-card transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-coral/40 hover:shadow-lift active:translate-y-0 active:scale-[0.99]"
            >
              <h2 className="font-display text-xl font-semibold text-ink group-hover:text-coral-deep">
                {trip.title}
              </h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-soft">
                {trip.destination && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin weight="fill" className="size-3.5 text-coral" />
                    {trip.destination}
                  </span>
                )}
                {trip.startDate && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarBlank weight="fill" className="size-3.5 text-ocean" />
                    <span className="tm-num">{formatDate(trip.startDate)}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Users weight="fill" className="size-3.5 text-ink-faint" />
                  {trip.userCount} 人 · {trip.dayCount} 天
                </span>
              </div>
            </button>
          ))}
        </section>
      )}

      {step.kind === "users" && (
        <section className="tm-pop-in flex w-full max-w-2xl flex-col items-center gap-8">
          <div className="flex flex-wrap justify-center gap-6">
            {users === null &&
              [0, 1, 2].map((i) => <Skeleton key={i} className="size-24 rounded-full" />)}
            {users?.map((u) => (
              <button
                key={u.id}
                onClick={() => pickUser(step.trip, u)}
                className="tm-focus group flex flex-col items-center gap-2 rounded-xl p-2 transition-transform duration-150 hover:-translate-y-1 active:translate-y-0"
              >
                <Avatar
                  user={u}
                  size="xl"
                  className="shadow-card ring-4 ring-surface transition-shadow group-hover:shadow-lift"
                />
                <span className="text-sm font-medium text-ink">{u.name}</span>
              </button>
            ))}
            {users?.length === 0 && (
              <p className="text-sm text-ink-soft">這個行程還沒有成員,請管理員新增。</p>
            )}
          </div>
          <BackButton onClick={() => setStep({ kind: "trips" })} />
        </section>
      )}

      {step.kind === "password" && (
        <section className="tm-pop-in flex w-full max-w-xs flex-col items-center gap-6">
          <Avatar user={step.user} size="xl" className="shadow-lift ring-4 ring-surface" />
          <form
            className="flex w-full flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input
              ref={pwRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密碼"
              autoComplete="current-password"
              className={cn("h-12 text-center text-base", error && "border-alert")}
            />
            {error && <p className="text-center text-[13px] text-alert">{error}</p>}
            <Button size="lg" loading={busy} disabled={!password} type="submit">
              進入行程
            </Button>
          </form>
          <BackButton
            onClick={() => setStep({ kind: "users", trip: step.trip })}
          />
        </section>
      )}
    </main>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="tm-focus inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
    >
      <ArrowLeft className="size-3.5" />
      返回
    </button>
  );
}
