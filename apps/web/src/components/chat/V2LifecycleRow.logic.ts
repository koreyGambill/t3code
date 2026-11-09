import type { OrchestrationV2Subagent, OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const ACTIVE_SUBAGENT_STATUSES = new Set<OrchestrationV2Subagent["status"]>([
  "pending",
  "running",
  "waiting",
]);

/** Claude can reuse resumed agent ids. Active agents supersede outcomes; settled agents must start after notification. */
export function subagentResumedSince(
  agent: Pick<OrchestrationV2Subagent, "status" | "startedAt">,
  notifiedAt: string,
): boolean {
  if (ACTIVE_SUBAGENT_STATUSES.has(agent.status)) return true;
  if (agent.startedAt === null) return false;
  const notifiedAtMillis = Date.parse(notifiedAt);
  return (
    !Number.isNaN(notifiedAtMillis) && DateTime.toEpochMillis(agent.startedAt) > notifiedAtMillis
  );
}

const STATUS_VISUALS: Record<
  OrchestrationV2TurnItem["status"],
  { dotClass: string; label: string }
> = {
  pending: { dotClass: "bg-info", label: "Queued" },
  running: { dotClass: "bg-info", label: "Running" },
  waiting: { dotClass: "bg-info", label: "Waiting" },
  idle: { dotClass: "bg-muted-foreground/50", label: "Idle · resumable" },
  completed: { dotClass: "bg-success", label: "Completed" },
  failed: { dotClass: "bg-destructive", label: "Failed" },
  cancelled: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
  interrupted: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
};

export function subagentStatusVisual(
  status: OrchestrationV2TurnItem["status"],
  child: {
    readonly hasPendingUserInput: boolean;
    readonly hasPendingApprovals: boolean;
  } | null = null,
) {
  if (ACTIVE_SUBAGENT_STATUSES.has(status)) {
    if (child?.hasPendingUserInput) return { dotClass: "bg-info", label: "Input requested" };
    if (child?.hasPendingApprovals) return { dotClass: "bg-info", label: "Approval requested" };
  }
  return STATUS_VISUALS[status];
}
