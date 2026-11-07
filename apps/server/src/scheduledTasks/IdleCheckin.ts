import type { ScheduledTaskId } from "@t3tools/contracts";

export function idleCheckinPrompt(taskId: ScheduledTaskId): string {
  return `[Automated cron: idle work check-in, every 30 minutes]
Is there ready, authorized work to continue or delegate in this main conversation? Please use your judgment about useful next steps; this reminder adds no scope or delegation target. If the work is done or waiting for a human, turn this reminder off and stay quiet.
Disable this reminder in Settings → Scheduled tasks → Idle work check-in (task ID: ${taskId}), or use schedule_task with scheduledTaskId="${taskId}" and enabled=false.`;
}
