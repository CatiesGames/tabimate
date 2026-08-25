"use client";

// 後台:行程 CRUD + 行程內成員管理(先建行程,再於行程中建立使用者)。
import { useCallback, useEffect, useState } from "react";
import {
  ArrowSquareOut,
  CaretDown,
  EyeSlash,
  Pencil,
  Plus,
  Trash,
  UserPlus,
} from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { AVATAR_COLORS } from "@/shared/config";
import {
  Avatar,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  Switch,
  Tag,
  toast,
} from "@/components/ui";

type AdminTrip = {
  id: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  status: string;
  isHidden: boolean;
  userCount: number;
};

type AdminUser = { id: string; name: string; color: string; isActive: boolean };

export default function AdminTripsPage() {
  const [trips, setTrips] = useState<AdminTrip[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminTrip | null>(null);

  const load = useCallback(() => {
    apiFetch<{ trips: AdminTrip[] }>("/api/admin/trips").then((d) => setTrips(d.trips));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">行程與成員</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus weight="bold" className="size-4" />
          建立行程
        </Button>
      </header>

      <div className="flex flex-col gap-3">
        {trips?.length === 0 && (
          <p className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-faint">
            還沒有行程 — 建立第一個行程,然後在行程裡新增成員。
          </p>
        )}
        {trips?.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            expanded={expanded === trip.id}
            onToggle={() => setExpanded(expanded === trip.id ? null : trip.id)}
            onChanged={load}
            onDelete={() => setDeleteTarget(trip)}
          />
        ))}
      </div>

      <TripFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          setCreateOpen(false);
          load();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`刪除「${deleteTarget?.title}」?`}
        description="行程、所有成員、聊天記錄與版本歷史都會永久刪除,無法復原。"
        confirmLabel="永久刪除"
        danger
        onConfirm={async () => {
          await apiFetch(`/api/admin/trips/${deleteTarget!.id}`, { method: "DELETE" });
          setDeleteTarget(null);
          toast("行程已刪除", { tone: "success" });
          load();
        }}
      />
    </div>
  );
}

function TripCard({
  trip,
  expanded,
  onToggle,
  onChanged,
  onDelete,
}: {
  trip: AdminTrip;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);

  const loadUsers = useCallback(() => {
    apiFetch<{ users: AdminUser[] }>(`/api/admin/trips/${trip.id}/users`).then((d) =>
      setUsers(d.users),
    );
  }, [trip.id]);

  useEffect(() => {
    if (expanded) loadUsers();
  }, [expanded, loadUsers]);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <button
        onClick={onToggle}
        className="tm-focus flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken/50"
      >
        <CaretDown
          weight="bold"
          className={cn("size-4 text-ink-faint transition-transform", expanded && "rotate-180")}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-display text-base font-semibold text-ink">{trip.title}</span>
            {trip.status === "archived" && <Tag>已封存</Tag>}
            {trip.isHidden && (
              <Tag tone="sun">
                <EyeSlash weight="fill" className="size-3" />
                登入頁隱藏中
              </Tag>
            )}
          </span>
          <span className="text-xs text-ink-faint">
            {trip.destination && `${trip.destination} · `}
            {trip.startDate && (
              <span className="tm-num">{trip.startDate} 出發 · </span>
            )}
            {trip.userCount} 位成員
          </span>
        </span>
        <span
          className="tm-focus rounded-md p-1.5 text-ink-faint hover:bg-ocean-wash hover:text-ocean-deep"
          role="link"
          title="開啟行程(新分頁;隱藏中的行程也可經此連結登入)"
          onClick={(e) => {
            e.stopPropagation();
            window.open(`/trips/${trip.id}`, "_blank", "noreferrer");
          }}
        >
          <ArrowSquareOut className="size-4" />
        </span>
        <span
          className="tm-focus rounded-md p-1.5 text-ink-faint hover:bg-sunken hover:text-ink"
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditOpen(true);
          }}
        >
          <Pencil className="size-4" />
        </span>
        <span
          className="tm-focus rounded-md p-1.5 text-ink-faint hover:bg-alert-wash hover:text-alert"
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash className="size-4" />
        </span>
      </button>

      {expanded && (
        <div className="border-t border-line px-4 py-3">
          <div className="flex flex-col gap-1">
            {users === null && <div className="tm-skeleton h-10 rounded-md" />}
            {users?.map((u) => (
              <div
                key={u.id}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-1.5",
                  !u.isActive && "opacity-45",
                )}
              >
                <Avatar user={u} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.name}</span>
                {!u.isActive && <Tag>已停用</Tag>}
                <button
                  onClick={() => setEditUser(u)}
                  className="tm-focus rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-sunken hover:text-ink"
                >
                  編輯
                </button>
              </div>
            ))}
            {users?.length === 0 && (
              <p className="px-2 py-2 text-xs text-ink-faint">還沒有成員。</p>
            )}
          </div>
          <button
            onClick={() => setAddUserOpen(true)}
            className="tm-focus mt-2 flex items-center gap-1.5 rounded-md border border-dashed border-line-strong px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-coral hover:text-coral-deep"
          >
            <UserPlus className="size-3.5" />
            新增成員
          </button>
        </div>
      )}

      <TripFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        trip={trip}
        onSaved={() => {
          setEditOpen(false);
          onChanged();
        }}
      />
      <UserFormDialog
        open={addUserOpen || editUser !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAddUserOpen(false);
            setEditUser(null);
          }
        }}
        tripId={trip.id}
        user={editUser}
        onSaved={() => {
          setAddUserOpen(false);
          setEditUser(null);
          loadUsers();
          onChanged();
        }}
      />
    </section>
  );
}

function TripFormDialog({
  open,
  onOpenChange,
  trip,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  trip?: AdminTrip;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [archived, setArchived] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(trip?.title ?? "");
      setDestination(trip?.destination ?? "");
      setStartDate(trip?.startDate ?? "");
      setArchived(trip?.status === "archived");
      setHidden(trip?.isHidden ?? false);
    }
  }, [open, trip]);

  const save = async () => {
    setBusy(true);
    try {
      if (trip) {
        await apiFetch(`/api/admin/trips/${trip.id}`, {
          method: "PATCH",
          json: {
            title,
            destination,
            startDate,
            status: archived ? "archived" : "planning",
            isHidden: hidden,
          },
        });
      } else {
        await apiFetch("/api/admin/trips", { json: { title, destination, startDate } });
      }
      toast(trip ? "行程已更新" : "行程已建立", { tone: "success" });
      onSaved();
    } catch {
      toast("儲存失敗,請檢查欄位", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={trip ? "編輯行程" : "建立行程"}>
      <div className="flex flex-col gap-4">
        <Field label="行程名稱">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="東京五日遊" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="目的地">
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="東京" />
          </Field>
          <Field label="出發日期" hint="YYYY-MM-DD">
            <Input
              value={startDate}
              onChange={(e) => setStartDate(e.target.value.replace(/[^\d-]/g, "").slice(0, 10))}
              placeholder="2026-10-12"
              className="tm-num"
            />
          </Field>
        </div>
        {trip && (
          <>
            <div className="flex items-center gap-3">
              <Switch checked={hidden} onChange={setHidden} label="登入頁隱藏" />
              <span className="text-[13px] text-ink-soft">
                在登入頁隱藏(內部測試用;仍可用後台的「開啟行程」直達連結登入)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={archived} onChange={setArchived} label="封存" />
              <span className="text-[13px] text-ink-soft">封存(完全停用,直達連結也擋)</span>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            loading={busy}
            disabled={!title.trim() || (!!startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate))}
            onClick={save}
          >
            {trip ? "儲存" : "建立"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function UserFormDialog({
  open,
  onOpenChange,
  tripId,
  user,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tripId: string;
  user: AdminUser | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [color, setColor] = useState<string>(AVATAR_COLORS[0]);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(user?.name ?? "");
      setPassword("");
      setColor(user?.color ?? AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
      setActive(user?.isActive ?? true);
    }
  }, [open, user]);

  const save = async () => {
    setBusy(true);
    try {
      if (user) {
        await apiFetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          json: {
            name,
            color,
            isActive: active,
            ...(password ? { password } : {}),
          },
        });
      } else {
        await apiFetch(`/api/admin/trips/${tripId}/users`, {
          json: { name, password, color },
        });
      }
      toast(user ? "成員已更新" : "成員已新增", { tone: "success" });
      onSaved();
    } catch (e) {
      toast(e instanceof Error && e.message.includes("名稱") ? e.message : "儲存失敗", {
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={user ? `編輯 ${user.name}` : "新增成員"}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Avatar user={{ id: "preview", name: name || "?", color }} size="lg" />
          <Field label="名稱" className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="小明" autoFocus />
          </Field>
        </div>
        <Field label="頭像顏色">
          <div className="flex flex-wrap gap-2">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`顏色 ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  "tm-focus size-8 rounded-full transition-transform",
                  color === c ? "scale-110 ring-2 ring-ink ring-offset-2" : "hover:scale-105",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>
        <Field
          label={user ? "重設密碼" : "密碼"}
          hint={user ? "留空表示不變更;變更後該成員會被登出" : "成員登入用"}
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {user && (
          <div className="flex items-center gap-3">
            <Switch checked={active} onChange={setActive} label="啟用" />
            <span className="text-[13px] text-ink-soft">
              {active ? "啟用中" : "已停用(無法登入)"}
            </span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            loading={busy}
            disabled={!name.trim() || (!user && !password)}
            onClick={save}
          >
            {user ? "儲存" : "新增"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
