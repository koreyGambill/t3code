import type { ScheduledTask, ScheduledTaskUpsertSchedule } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ScheduledTaskError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const encodeFingerprint = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

type WakeCondition = NonNullable<
  Extract<ScheduledTaskUpsertSchedule, { type: "interval" }>["wakeWhen"]
>;

export const pinGitWake = Effect.fn("ScheduledTaskService.pinGitWake")(function* (
  condition: WakeCondition,
) {
  if (condition.type !== "git_landed") return condition;
  const available = yield* Effect.serviceOption(GitVcsDriver.GitVcsDriver);
  if (Option.isNone(available))
    return yield* new ScheduledTaskError({ message: "Git wake conditions are unavailable." });
  const git = available.value;
  const result = yield* git.execute({
    operation: "ScheduledTaskService.pinGitWake",
    cwd: condition.repoPath,
    args: ["rev-parse", "--verify", "--end-of-options", `${condition.ref}^{commit}`],
  });
  return { ...condition, ref: result.stdout.trim() };
});

export const wakeReason = Effect.fn("ScheduledTaskService.wakeReason")(function* (
  task: Pick<ScheduledTask, "schedule" | "threadId">,
) {
  const condition = task.schedule.type === "interval" ? task.schedule.wakeWhen : undefined;
  if (condition === undefined) return null;
  const sql = yield* SqlClient.SqlClient;
  if (condition.type === "git_landed") {
    const available = yield* Effect.serviceOption(GitVcsDriver.GitVcsDriver);
    if (Option.isNone(available))
      return yield* new ScheduledTaskError({ message: "Git wake conditions are unavailable." });
    const git = available.value;
    const result = yield* git.execute({
      operation: "ScheduledTaskService.wakeReason",
      cwd: condition.repoPath,
      args: ["merge-base", "--is-ancestor", condition.ref, condition.main ?? "refs/heads/main"],
      allowNonZeroExit: true,
    });
    if (result.exitCode > 1)
      return yield* new ScheduledTaskError({ message: "Could not inspect the main branch." });
    return result.exitCode === 0
      ? `${condition.ref} landed on ${condition.main ?? "main"} in ${condition.repoPath}`
      : null;
  }
  if (condition.type === "task_finished") {
    const [row] = yield* sql<{
      status: string;
    }>`SELECT status FROM orchestration_v2_projection_subagents
      WHERE thread_id = ${task.threadId} AND (subagent_id = ${condition.task} OR json_extract(payload_json, '$.title') = ${condition.task})
      ORDER BY updated_at DESC, subagent_id DESC LIMIT 1`;
    return row !== undefined &&
      ["completed", "failed", "cancelled", "interrupted"].includes(row.status)
      ? `delegated task ${condition.task} finished (${row.status})`
      : null;
  }
  const [run] = yield* sql<{ status: string }>`SELECT status FROM orchestration_v2_projection_runs
    WHERE thread_id = ${condition.threadId} ORDER BY ordinal DESC LIMIT 1`;
  return run !== undefined &&
    ["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(run.status)
    ? `thread ${condition.threadId} finished (${run.status})`
    : null;
});

export const checkinFingerprint = Effect.fn("ScheduledTaskService.checkinFingerprint")(function* (
  task: ScheduledTask,
) {
  const sql = yield* SqlClient.SqlClient;
  const children =
    yield* sql`SELECT subagent_id, status, child_thread_id FROM orchestration_v2_projection_subagents
    WHERE thread_id = ${task.threadId} ORDER BY subagent_id`;
  // Scheduled turns must not invalidate their own baseline when they complete.
  const runs =
    yield* sql`SELECT r.status, COUNT(*) AS count, MAX(r.ordinal) AS latest, MAX(m.updated_at) AS edited FROM orchestration_v2_projection_runs r
    LEFT JOIN orchestration_v2_projection_messages m ON m.message_id = json_extract(r.payload_json, '$.userMessageId')
    WHERE r.thread_id = ${task.threadId} AND json_extract(m.payload_json, '$.scheduledTaskId') IS NULL
    GROUP BY r.status ORDER BY r.status`;
  const watches =
    yield* sql`SELECT json_extract(p.value, '$.url') AS url, json_remove(json_extract(p.value, '$.watch'), '$.remarksThrough', '$.startedAt', '$.checksAwaitedSince', '$.wakes') AS watch,
      json_extract(p.value, '$.snapshot.state') AS state, json_extract(p.value, '$.snapshot.headBranch') AS head,
      json_extract(p.value, '$.snapshot.checksState') AS checks, json_extract(p.value, '$.snapshot.reviewDecision') AS review,
      json_extract(p.value, '$.snapshot.mergeability') AS mergeability
    FROM orchestration_v2_projection_threads t, json_each(t.payload_json, '$.pullRequests') p
    WHERE t.thread_id = ${task.threadId} ORDER BY url`;
  const conditions = yield* sql`SELECT task_id, enabled, schedule_json FROM scheduled_tasks
    WHERE thread_id = ${task.threadId} AND task_id <> ${task.id} ORDER BY task_id`;
  return yield* encodeFingerprint([
    task.prompt,
    task.schedule,
    children,
    runs,
    watches,
    conditions,
  ]);
});
