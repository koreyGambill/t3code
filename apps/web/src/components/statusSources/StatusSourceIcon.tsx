import type { StatusSource, StatusState } from "@t3tools/contracts";
import {
  ActivityIcon,
  CloudIcon,
  GlobeIcon,
  HeartPulseIcon,
  ServerIcon,
  ShieldCheckIcon,
  TerminalIcon,
  WorkflowIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";

export const STATUS_SOURCE_ICONS = {
  activity: ActivityIcon,
  cloud: CloudIcon,
  globe: GlobeIcon,
  "heart-pulse": HeartPulseIcon,
  server: ServerIcon,
  "shield-check": ShieldCheckIcon,
  terminal: TerminalIcon,
  workflow: WorkflowIcon,
};

export function StatusSourceIcon({ source }: { source: StatusSource }) {
  if (source.config.icon === "favicon" && source.favicon?.startsWith("data:image/")) {
    return <img src={source.favicon} alt="" className="size-4 shrink-0 object-contain" />;
  }
  const Icon =
    STATUS_SOURCE_ICONS[source.config.icon as keyof typeof STATUS_SOURCE_ICONS] ?? ActivityIcon;
  return <Icon className="size-4 shrink-0" aria-hidden />;
}

const STATE_COLORS = {
  ok: "bg-success",
  warn: "bg-warning",
  fail: "bg-destructive",
  unknown: "bg-muted-foreground",
} satisfies Record<StatusState, string>;

export function StatusSourceDot({ state }: { state: StatusState }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", STATE_COLORS[state])}
    />
  );
}
