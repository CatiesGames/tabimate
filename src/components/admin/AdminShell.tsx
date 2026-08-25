"use client";

// 後台外殼:.env 管理員帳密登入 gate + 側欄導覽。
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AirplaneTilt, Gear, SignOut, SuitcaseRolling } from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button, Field, Input, ToastHost } from "@/components/ui";

const AdminReady = createContext(false);
export const useAdminReady = () => useContext(AdminReady);

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    apiFetch("/api/admin/me")
      .then(() => setState("ready"))
      .catch(() => setState("login"));
  }, []);

  if (state === "loading") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center">
        <span className="tm-skeleton size-10 rounded-full" />
      </main>
    );
  }

  if (state === "login") {
    return <AdminLogin onSuccess={() => setState("ready")} />;
  }

  const nav = [
    { href: "/admin/trips", label: "行程與成員", icon: SuitcaseRolling },
    { href: "/admin/settings", label: "系統設定", icon: Gear },
  ];

  return (
    <div className="flex min-h-[100dvh] bg-bg">
      <ToastHost />
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface p-3">
        <div className="mb-6 flex items-center gap-2 px-2 pt-1">
          <span className="flex size-8 items-center justify-center rounded-lg bg-coral text-white">
            <AirplaneTilt weight="fill" className="size-4.5" />
          </span>
          <div>
            <p className="font-display text-sm font-bold text-ink">tabimate</p>
            <p className="text-[10px] text-ink-faint">管理後台</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "tm-focus flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                pathname.startsWith(item.href)
                  ? "bg-coral-wash font-medium text-coral-deep"
                  : "text-ink-soft hover:bg-sunken hover:text-ink",
              )}
            >
              <item.icon weight={pathname.startsWith(item.href) ? "fill" : "regular"} className="size-4.5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={async () => {
            await apiFetch("/api/admin/logout", { json: {} });
            router.replace("/");
          }}
          className="tm-focus mt-auto flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        >
          <SignOut className="size-4.5" />
          離開後台
        </button>
      </aside>
      <main className="tm-scroll min-w-0 flex-1 overflow-y-auto p-8">
        <AdminReady.Provider value>{children}</AdminReady.Provider>
      </main>
    </div>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/admin/login", { json: { username, password } });
      onSuccess();
    } catch {
      setError("帳號或密碼不正確");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="tm-pop-in flex w-full max-w-xs flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-lift"
      >
        <h1 className="font-display text-lg font-bold text-ink">管理後台</h1>
        <Field label="帳號">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </Field>
        <Field label="密碼" error={error ?? undefined}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={busy} disabled={!username || !password}>
          登入
        </Button>
      </form>
    </main>
  );
}
