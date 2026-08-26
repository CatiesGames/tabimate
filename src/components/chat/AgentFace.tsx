"use client";

// 塔比頭像與名字:變身後顯示自訂頭貼/名稱,否則預設機器人。
// 聊天頭部、訊息列、空狀態、靈魂面板共用。
import { Robot } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { useChat, useSession } from "@/lib/workspace/WorkspaceProvider";

/** 塔比頭像:自訂頭貼固定正圓滿版(shrink-0 防 flex 壓扁),裁切焦點偏上保住人物臉部。 */
export function AgentFace({
  className,
  iconClassName,
}: {
  className: string;
  iconClassName: string;
}) {
  const { agent } = useChat();
  const { tripId } = useSession();
  if (agent.identity.avatarVersion) {
    return (
      <img
        src={`/api/trips/${tripId}/agent/avatar?v=${agent.identity.avatarVersion}`}
        alt={agent.identity.name ?? "塔比"}
        className={cn(className, "shrink-0 overflow-hidden object-cover object-[50%_25%]")}
      />
    );
  }
  return (
    <span className={cn(className, "shrink-0 bg-ocean text-white")}>
      <Robot weight="fill" className={iconClassName} />
    </span>
  );
}

/** 塔比目前的名字(變身後為自訂名稱)。 */
export function useAgentName() {
  const { agent } = useChat();
  return agent.identity.name || "塔比";
}
