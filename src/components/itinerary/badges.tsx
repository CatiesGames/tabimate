"use client";

import { CalendarCheck, SealCheck, Ticket, Warning } from "@phosphor-icons/react";

import type { Stop } from "@/shared/types";
import { Hint, Tag } from "@/components/ui";

/** 需購票類用「購票」詞,其餘用「預約」詞(需購票的狀態操作曾因字眼對不上被找不到)。 */
export function bookingWords(stop: Stop) {
  const ticket = stop.bookingType === "ticket_required";
  return {
    todo: ticket ? "未購票" : "未預約",
    done: ticket ? "已購票" : "已預約",
    fail: ticket ? "買不到" : "訂不到",
  };
}

/** 預約狀態 badge:免預約不顯示(不加噪音)。 */
export function BookingBadge({ stop, size = "sm" }: { stop: Stop; size?: "sm" | "md" }) {
  if (stop.bookingType === "none") return null;
  const cls = size === "sm" ? "!px-1.5 !py-0 !text-[11px]" : "";
  const words = bookingWords(stop);

  if (stop.bookingStatus === "booked") {
    return (
      <Tag tone="leaf" className={cls}>
        <CalendarCheck weight="fill" className="size-3" />
        {words.done}
      </Tag>
    );
  }
  if (stop.bookingStatus === "unavailable") {
    return (
      <Tag tone="alert" className={cls}>
        <Warning weight="fill" className="size-3" />
        {words.fail}
      </Tag>
    );
  }

  // 未訂:依急迫性著色
  const deadline = stop.booking?.deadline;
  const urgent =
    deadline && new Date(deadline).getTime() - Date.now() < 7 * 86_400_000;
  if (stop.bookingType === "reservation_required") {
    return (
      <Tag tone={urgent ? "alert" : "sun"} className={cls}>
        <Warning weight="fill" className="size-3" />
        需預約
      </Tag>
    );
  }
  if (stop.bookingType === "ticket_required") {
    return (
      <Tag tone={urgent ? "alert" : "ocean"} className={cls}>
        <Ticket weight="fill" className="size-3" />
        需購票
      </Tag>
    );
  }
  if (stop.bookingType === "recommended") {
    return (
      <Tag tone="neutral" className={cls}>
        建議預約
      </Tag>
    );
  }
  return (
    <Tag tone="neutral" className={cls}>
      現場排隊
    </Tag>
  );
}

const verifyTimeLabel = (ts: number) =>
  new Date(ts).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

function verifyTip(stop: Stop): string {
  const lines: string[] = [];
  const ts = stop.verifiedAt ?? stop.verifySources[0]?.checkedAt ?? null;
  lines.push(
    stop.verifyStatus === "stale"
      ? "塔比查到的資訊與行程內容不一致,建議再確認"
      : `塔比已上網查證營業時間與資訊${ts ? `(${verifyTimeLabel(ts)})` : ""}`,
  );
  if (stop.verifySources.length > 0) {
    lines.push(`來源:${stop.verifySources.map((s) => s.title).join("、")}`);
    lines.push("點開地點詳情可開啟來源連結");
  }
  return lines.join("\n");
}

export function VerifyBadge({ stop, size = "sm" }: { stop: Stop; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "!px-1.5 !py-0 !text-[11px]" : "";
  if (stop.verifyStatus === "verified") {
    return (
      <Hint tip={verifyTip(stop)}>
        <Tag tone="leaf" className={cls}>
          <SealCheck weight="fill" className="size-3" />
          已查證
        </Tag>
      </Hint>
    );
  }
  if (stop.verifyStatus === "stale") {
    return (
      <Hint tip={verifyTip(stop)}>
        <Tag tone="alert" className={cls}>
          <Warning weight="fill" className="size-3" />
          資訊衝突
        </Tag>
      </Hint>
    );
  }
  return null;
}
