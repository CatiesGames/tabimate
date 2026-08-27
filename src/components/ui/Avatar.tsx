"use client";

import { Robot } from "@phosphor-icons/react";

import { AGENT_USER_ID } from "@/shared/config";
import { cn } from "@/lib/cn";

const SIZE = {
  xs: "size-5 text-[10px]",
  sm: "size-7 text-[12px]",
  md: "size-9 text-sm",
  lg: "size-12 text-lg",
  xl: "size-16 text-2xl",
} as const;

export type AvatarUser = {
  id: string;
  name: string;
  color: string;
  /** 有值就顯示圖片頭貼(塔比變身後的自訂頭貼);裁切焦點偏上保住臉。 */
  avatarUrl?: string | null;
};

/** 彩色圓盤 + 名字首字。agent 偽成員顯示機器人 icon(海洋青)。 */
export function Avatar({
  user,
  size = "md",
  online,
  className,
}: {
  user: AvatarUser;
  size?: keyof typeof SIZE;
  online?: boolean;
  className?: string;
}) {
  const isAgent = user.id === AGENT_USER_ID;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white",
        SIZE[size],
        className,
      )}
      style={{ backgroundColor: isAgent ? "var(--tm-ocean)" : user.color }}
      title={user.name}
    >
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.name}
          className="size-full rounded-full object-cover object-[50%_25%]"
        />
      ) : isAgent ? (
        <Robot weight="fill" className="size-[60%]" />
      ) : (
        [...user.name][0]
      )}
      {online != null && (
        <span
          className={cn(
            "absolute -right-px -bottom-px block size-[30%] rounded-full ring-2 ring-surface",
            online ? "bg-leaf" : "bg-ink-faint",
          )}
        />
      )}
    </span>
  );
}

export function AvatarStack({
  users,
  size = "sm",
  max = 4,
  className,
}: {
  users: AvatarUser[];
  size?: keyof typeof SIZE;
  max?: number;
  className?: string;
}) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className={cn("inline-flex items-center -space-x-1.5", className)}>
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} className="ring-2 ring-surface" />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-sunken font-medium text-ink-soft ring-2 ring-surface",
            SIZE[size],
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
