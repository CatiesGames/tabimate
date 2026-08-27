const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 今天(本地時區)的 YYYY-MM-DD。不能用 toISOString(UTC 會慢 8 小時)。 */
export function todayISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** YYYY-MM-DD 加 n 天(本地時區字串運算)。 */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

/** 兩個 YYYY-MM-DD 相差天數(b - a)。 */
export function diffDaysISO(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000,
  );
}

/** trip.startDate + dayPosition → 「10/14 (二)」;無日期回 null。 */
export function dayDateLabel(startDate: string | null, position: number): string | null {
  if (!startDate) return null;
  const d = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + position);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return new Date(ts).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}

/** 聊天日期標籤:今天/昨天/M/D (週X)。 */
export function chatDateLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
}

export function clockLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
