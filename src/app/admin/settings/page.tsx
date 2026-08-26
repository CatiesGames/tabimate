"use client";

// 後台設定:除了 .env 四項,所有設定都在這裡(存 settings 表,即時生效)。
import { useEffect, useMemo, useState } from "react";
import {
  ArrowSquareOut,
  BookOpen,
  CaretDown,
  Eye,
  EyeSlash,
} from "@phosphor-icons/react";

import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button, ConfirmDialog, Field, Input, SegmentedChips, toast } from "@/components/ui";

type Settings = Record<string, string>;

const MODEL_PRESETS = [
  { value: "claude-opus-5", label: "Opus 5" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

type Usage = Record<string, { monthUsed: number; todayUsed: number; limit: number }>;

export default function AdminSettingsPage() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings>({});
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    apiFetch<{ settings: Settings; usage: Usage }>("/api/admin/settings").then((d) => {
      setSaved(d.settings);
      setDraft(d.settings);
      setUsage(d.usage);
    });
  }, []);

  const dirty = useMemo(
    () => saved !== null && Object.keys(draft).some((k) => draft[k] !== saved[k]),
    [draft, saved],
  );

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      const patch: Settings = {};
      for (const k of Object.keys(draft)) if (draft[k] !== saved?.[k]) patch[k] = draft[k];
      const res = await apiFetch<{ settings: Settings }>("/api/admin/settings", {
        method: "PUT",
        json: patch,
      });
      setSaved(res.settings);
      setDraft(res.settings);
      toast("設定已儲存,立即生效", { tone: "success" });
    } catch {
      toast("儲存失敗", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (saved === null) {
    return <div className="mx-auto max-w-2xl"><div className="tm-skeleton h-60 rounded-xl" /></div>;
  }

  const customModel = !MODEL_PRESETS.some((m) => m.value === draft.agent_model);

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <h1 className="mb-6 font-display text-xl font-bold text-ink">系統設定</h1>

      <Section
        title="Google 地圖"
        description="兩把金鑰都設定後,地圖、地點搜尋、照片、路線即時點亮(所有人免重整)。"
      >
        <MapsKeyGuide />
        <SecretField
          label="伺服器 API Key"
          hint="Places / Routes / 照片代理用;限制為 API key(不設 referrer)"
          value={draft.google_maps_api_key ?? ""}
          onChange={(v) => set("google_maps_api_key", v)}
        />
        <SecretField
          label="瀏覽器 Maps JavaScript Key"
          hint="互動地圖用;建議加 HTTP referrer 限制(localhost 與你的區網 IP)"
          value={draft.google_maps_browser_key ?? ""}
          onChange={(v) => set("google_maps_browser_key", v)}
        />
      </Section>

      <Section title="塔比(AI 旅遊嚮導)" description="模型與行為;變更於下一則訊息生效。">
        <Field label="模型">
          <div className="flex flex-col gap-2">
            <SegmentedChips
              options={MODEL_PRESETS}
              value={customModel ? null : (draft.agent_model as never)}
              onChange={(v) => set("agent_model", v)}
            />
            <Input
              value={draft.agent_model ?? ""}
              onChange={(e) => set("agent_model", e.target.value)}
              placeholder="或自行輸入完整模型名"
              className="tm-num text-[13px]"
            />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="單輪最大回合數">
            <Input
              className="tm-num"
              value={draft.agent_max_turns ?? ""}
              onChange={(e) => set("agent_max_turns", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="逾時秒數" hint="無輸出超過此秒數視為卡住">
            <Input
              className="tm-num"
              value={draft.agent_stall_timeout_sec ?? ""}
              onChange={(e) => set("agent_stall_timeout_sec", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
        </div>
        <Field label="附加系統提示" hint="附加在內建規則之後,可放旅伴偏好(如:我們不吃生食)">
          <textarea
            value={draft.agent_system_prompt_extra ?? ""}
            onChange={(e) => set("agent_system_prompt_extra", e.target.value)}
            rows={3}
            className="tm-focus w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-ink-faint focus-visible:border-ocean focus-visible:ring-2 focus-visible:ring-ocean/25 focus-visible:outline-none"
          />
        </Field>
      </Section>

      <Section
        title="免費額度防護(每月呼叫上限)"
        description="對齊 Google 的月度免費額度:只計實際打到 Google 的呼叫(快取命中不算);本月累計達上限自動降級(搜尋轉手動、照片轉色塊),下月 1 號恢復,絕不產生費用。單日用量大沒關係,看的是整月。0 = 不限制。"
      >
        <div className="flex flex-col gap-3">
          {(
            [
              ["autocomplete", "limit_autocomplete_monthly", "地點搜尋", "Essentials · 每月 1 萬次免費"],
              ["routes", "limit_routes_monthly", "路線規劃", "Essentials · 每月 1 萬次免費"],
              ["staticmap", "limit_staticmap_monthly", "PDF 靜態地圖", "Essentials · 每月 1 萬次免費"],
              ["place_details", "limit_place_details_monthly", "地點詳情(含營業時間/評分)", "Enterprise · 每月僅 1 千次免費"],
              ["photos", "limit_photos_monthly", "地點照片", "Enterprise · 每月僅 1 千次免費"],
            ] as const
          ).map(([kind, key, label, tier]) => {
            const u = usage?.[kind];
            const limit = Number(draft[key]) || 0;
            const pct =
              u && limit > 0 ? Math.min(100, Math.round((u.monthUsed / limit) * 100)) : 0;
            return (
              <div key={key} className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{label}</p>
                  <p className="text-[11px] text-ink-faint">{tier}</p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width]",
                        pct >= 90 ? "bg-alert" : pct >= 60 ? "bg-sun" : "bg-leaf",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className="tm-num w-32 shrink-0 text-right text-xs text-ink-soft">
                  本月 {u?.monthUsed ?? 0} / {limit || "∞"}
                  <span className="block text-[10px] text-ink-faint">
                    今日 {u?.todayUsed ?? 0}
                  </span>
                </span>
                <Input
                  className="tm-num w-24 shrink-0 text-center"
                  value={draft[key] ?? ""}
                  onChange={(e) => set(key, e.target.value.replace(/\D/g, ""))}
                />
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="快取" description="Google API 回應快取天數(控費;place_id 永久快取為 Google 條款允許)。">
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["cache_ttl_autocomplete_days", "地點搜尋(天)"],
              ["cache_ttl_place_details_days", "地點詳情(天)"],
              ["cache_ttl_photos_days", "照片(天)"],
              ["cache_ttl_directions_transit_hours", "大眾運輸路線(小時)"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                className="tm-num"
                value={draft[key] ?? ""}
                onChange={(e) => set(key, e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          ))}
        </div>
      </Section>

      <CacheStoreSection />

      {/* 儲存列 */}
      <div
        className={cn(
          "fixed right-0 bottom-0 left-52 flex items-center justify-end gap-3 border-t border-line bg-surface/90 px-8 py-3 backdrop-blur transition-transform",
          dirty ? "translate-y-0" : "translate-y-full",
        )}
      >
        <span className="text-[13px] text-ink-soft">有未儲存的變更</span>
        <Button variant="ghost" onClick={() => setDraft(saved)}>
          還原
        </Button>
        <Button loading={busy} onClick={save}>
          儲存變更
        </Button>
      </div>
    </div>
  );
}

const GUIDE_STEPS: Array<{
  title: string;
  body: React.ReactNode;
  link?: { href: string; label: string };
}> = [
  {
    title: "建立 Google Cloud 專案",
    body: "用你的 Google 帳號登入 Google Cloud Console,建立一個新專案(名稱隨意,例如 tabimate)。之後所有步驟都在這個專案底下操作,注意頁面頂端的專案選擇器要停在它上面。",
    link: { href: "https://console.cloud.google.com/projectcreate", label: "建立專案" },
  },
  {
    title: "啟用計費(綁一張信用卡)",
    body: "Google Maps 必須綁信用卡才能用。2025/3 起的新制:每個 API 每月各有免費呼叫額度 — 地圖載入/地點搜尋/路線是 1 萬次,「地點詳情(含營業時間)」與「地點照片」屬 Enterprise 級只有 1 千次。個人旅遊規劃加上 tabimate 的伺服器快取與每日上限(見下方「免費額度防護」),正常使用不會產生費用。左側選單「帳單」→ 建立計費帳戶,照指示填卡片。",
    link: { href: "https://console.cloud.google.com/billing", label: "帳單設定" },
  },
  {
    title: "(保險)設定預算警示",
    body: "帳單 →「預算與快訊」→ 建立預算,金額設個小數字(例如 US$5),用量異常時 Google 會寄信提醒你。這步非必要,但設了最安心。",
    link: {
      href: "https://console.cloud.google.com/billing/budgets",
      label: "預算與快訊",
    },
  },
  {
    title: "啟用三個 API",
    body: "在 API 程式庫分別搜尋並「啟用」:Maps JavaScript API(互動地圖)、Places API (New)(地點搜尋/營業時間/照片)、Routes API(路線與大眾運輸班次)、Maps Static API(PDF 匯出的每日地圖)。四個都要啟用。",
    link: {
      href: "https://console.cloud.google.com/apis/library",
      label: "API 程式庫",
    },
  },
  {
    title: "建立第 1 把:伺服器 API Key",
    body: "「憑證」→ 建立憑證 → API 金鑰。建好後點進金鑰編輯:「應用程式限制」選「無」,「API 限制」選「限制金鑰」並勾 Places API (New)、Routes API 與 Maps Static API。複製金鑰貼到下面的「伺服器 API Key」欄位。",
    link: {
      href: "https://console.cloud.google.com/apis/credentials",
      label: "憑證頁面",
    },
  },
  {
    title: "建立第 2 把:瀏覽器 Maps JavaScript Key",
    body: "再建立一把 API 金鑰:「應用程式限制」選「網站」,加入 http://localhost:4680/* 與 http://<你的區網IP>:4680/*(手機平板連的那個 IP);「API 限制」勾 Maps JavaScript API。複製貼到下面的「瀏覽器 Maps JavaScript Key」欄位。",
  },
  {
    title: "(強烈建議)在 Google 端設定用量上限 — 保證不收費的硬鎖",
    body: "真正的月度預算由 tabimate 內建的「每月上限」控管(下方區塊,預設已開);Google 端只有「每日」制上限,把它當寬鬆的兜底防線:「配額與系統限制」分別選 Maps JavaScript API、Places API (New)、Routes API,把「每日請求數」從「無上限」改成:Maps JavaScript 1000/日、Autocomplete 1000/日、Routes 1000/日、Place Details 100/日、Place Photos 100/日。這個數字平常絕不會碰到,但萬一 key 外洩被盜刷,Google 會直接擋請求而不是收費。雙層保險,想爆額度都難。",
    link: {
      href: "https://console.cloud.google.com/google/maps-apis/quotas",
      label: "配額設定",
    },
  },
  {
    title: "存檔,完成!",
    body: "按下方「儲存變更」。所有成員的畫面會立刻點亮互動地圖、地點搜尋、照片與路線,不用重新整理。之後可以隨時回到這頁,在「免費額度防護」看今日用量。",
  },
];

function MapsKeyGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-ocean/25 bg-ocean-wash/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="tm-focus flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] font-medium text-ocean-deep transition-colors hover:bg-ocean-wash"
      >
        <BookOpen weight="fill" className="size-4 shrink-0" />
        還沒有金鑰?看完整免費申請流程
        <CaretDown
          weight="bold"
          className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <ol className="tm-pop-in flex flex-col gap-3 border-t border-ocean/20 px-3.5 py-3">
          {GUIDE_STEPS.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="tm-num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ocean text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-medium text-ink">
                  {step.title}
                  {step.link && (
                    <a
                      href={step.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-[11px] font-normal text-ocean-deep hover:underline"
                    >
                      <ArrowSquareOut className="size-3" />
                      {step.link.label}
                    </a>
                  )}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 mb-4 text-xs text-ink-faint">{description}</p>}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function SecretField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <Field label={label} hint={value ? hint : `${hint ?? ""}(尚未設定)`}>
      <div className="relative">
        <Input
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="貼上 API key"
          autoComplete="off"
          className="tm-num pr-10"
        />
        <button
          type="button"
          aria-label={reveal ? "隱藏" : "顯示"}
          onClick={() => setReveal(!reveal)}
          className="tm-focus absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink"
        >
          {reveal ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </Field>
  );
}

/** 已快取內容管理:分類統計 + 手動清除(路線沒變時想強制重生成 PDF 地圖等就清這裡)。 */
function CacheStoreSection() {
  const [caches, setCaches] = useState<Array<{
    kind: string;
    label: string;
    count: number;
  }> | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<{ kind: string; label: string } | null>(null);

  const load = () =>
    apiFetch<{ caches: Array<{ kind: string; label: string; count: number }> }>(
      "/api/admin/caches",
    ).then((d) => setCaches(d.caches));
  useEffect(() => {
    load();
  }, []);

  const clear = async (kind: string, label: string) => {
    setClearing(kind);
    try {
      const r = await apiFetch<{ cleared: number }>("/api/admin/caches/clear", {
        json: { kind },
      });
      toast(`已清除「${label}」快取 ${r.cleared} 筆,下次使用會重新向 Google 取得`);
      await load();
    } finally {
      setClearing(null);
    }
  };

  return (
    <Section
      title="已快取的 Google 內容"
      description="內容沒變時會一直用快取(例如路線沒動,PDF 地圖就不會重新生成)。想強制重新取得就清掉對應分類;清除後的下一次使用會重新呼叫 Google(計入上方月用量)。"
    >
      <div className="flex flex-col gap-2">
        {caches === null && <p className="text-xs text-ink-faint">載入中…</p>}
        {caches?.map((c) => (
          <div key={c.kind} className="flex items-center justify-between gap-3 rounded-lg bg-sunken/60 px-3 py-2">
            <p className="min-w-0 flex-1 text-[13px] text-ink">
              {c.label}
              <span className="tm-num ml-2 text-xs text-ink-faint">{c.count} 筆</span>
            </p>
            <Button
              size="sm"
              variant="ghost"
              disabled={c.count === 0}
              loading={clearing === c.kind}
              onClick={() => setConfirmKind({ kind: c.kind, label: c.label })}
            >
              清除
            </Button>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={confirmKind !== null}
        onOpenChange={(o) => !o && setConfirmKind(null)}
        title={`清除「${confirmKind?.label ?? ""}」快取?`}
        description="清除後的下一次使用會重新向 Google 取得(照舊計費/計入月上限);內容本身不受影響。"
        confirmLabel="清除"
        danger
        onConfirm={() => {
          if (confirmKind) clear(confirmKind.kind, confirmKind.label);
          setConfirmKind(null);
        }}
      />
    </Section>
  );
}
