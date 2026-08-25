"use client";

// dev-only:設計 token 與基礎元件展示頁,驗證字體/顏色/keyframes 有正確編譯。
import { useState } from "react";

import { CATEGORY_META } from "@/lib/categories";
import { STOP_CATEGORIES, type StopCategory } from "@/shared/config";
import {
  Avatar,
  AvatarStack,
  Button,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  PulseDots,
  SegmentedChips,
  Skeleton,
  Spinner,
  Switch,
  Tag,
  toast,
  ToastHost,
} from "@/components/ui";
import { PaperPlane, Stop } from "@phosphor-icons/react";

const DEMO_USERS = [
  { id: "u1", name: "小明", color: "#FF5D47" },
  { id: "u2", name: "小美", color: "#8B5CF6" },
  { id: "u3", name: "阿哲", color: "#3B82F6" },
  { id: "agent", name: "AI 助手", color: "" },
];

export default function KitPage() {
  const [cat, setCat] = useState<StopCategory>("sight");
  const [on, setOn] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
      <ToastHost />
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          tabimate 設計元件
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          晴空假期 token 系統 <span className="tm-num">2026-08-25 14:30</span>
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink-soft">按鈕</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>建立行程</Button>
          <Button variant="ocean">
            <PaperPlane weight="fill" className="size-4" />
            送出
          </Button>
          <Button variant="soft">還原此版本</Button>
          <Button variant="ghost">取消</Button>
          <Button variant="danger">刪除</Button>
          <Button loading>套用中</Button>
          <IconButton label="停止" variant="soft">
            <Stop weight="fill" className="size-5" />
          </IconButton>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink-soft">分類 chips</h2>
        <SegmentedChips
          options={STOP_CATEGORIES.map((c) => {
            const meta = CATEGORY_META[c];
            const Icon = meta.icon;
            return {
              value: c,
              label: meta.label,
              icon: (
                <Icon weight="duotone" className="size-4" style={{ color: meta.colorVar }} />
              ),
            };
          })}
          value={cat}
          onChange={setCat}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink-soft">頭像與 presence</h2>
        <div className="flex items-center gap-6">
          <AvatarStack users={DEMO_USERS} />
          <Avatar user={DEMO_USERS[0]} online />
          <Avatar user={DEMO_USERS[3]} size="lg" />
          <PulseDots />
          <Spinner />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink-soft">標籤</h2>
        <div className="flex flex-wrap gap-2">
          <Tag tone="sun">需預約</Tag>
          <Tag tone="leaf">已預約</Tag>
          <Tag tone="ocean">需購票</Tag>
          <Tag tone="alert">截止日逼近</Tag>
          <Tag tone="coral">已中止</Tag>
          <Tag>版本 12</Tag>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <Field label="行程名稱" hint="例如:東京五日遊">
          <Input placeholder="輸入名稱" />
        </Field>
        <div className="flex items-end gap-3 pb-1">
          <Switch checked={on} onChange={setOn} label="開關" />
          <span className="text-sm text-ink-soft">{on ? "開啟" : "關閉"}</span>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink-soft">載入與回饋</h2>
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-24" />
          <Button
            variant="soft"
            onClick={() =>
              toast("小美 把 淺草寺 移到 Day 2", { actor: DEMO_USERS[1] })
            }
          >
            歸屬 toast
          </Button>
          <Button variant="ghost" onClick={() => toast("已儲存", { tone: "success" })}>
            成功 toast
          </Button>
          <Button variant="ghost" onClick={() => setConfirmOpen(true)}>
            確認框
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="還原到版本 8?"
        description="行程會回到 昨天 21:04(小明 確認)的狀態。這個動作本身也會成為一個新版本,隨時可以再還原回來。"
        confirmLabel="還原"
        onConfirm={() => setConfirmOpen(false)}
      />
    </main>
  );
}
