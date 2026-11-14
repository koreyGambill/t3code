import {
  MessageId,
  type RunId,
  ScheduledTaskId,
  type ScheduledTaskListRunsResult,
  type ScheduledTaskRun,
  ScheduledTaskRunId,
  type ScheduledTaskRunOutcome,
  ThreadId,
  TurnTokenUsage,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import type { PricedRecord } from "../usage/usagePricing.ts";

export const RUN_RETENTION_PER_TASK = 200;
export const RUNS_PAGE_SIZE = 50;

export interface RunTrigger {
  readonly type: "schedule" | "webhook" | "event" | "manual" | "agent";
  readonly summary: string;
}

interface RunRow {
  readonly id: string;
  readonly task_id: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly status: string;
  readonly trigger_json: string;
  readonly thread_id: string | null;
  readonly message_id: string | null;
  readonly orchestration_run_id: string | null;
  readonly cost_usd: number | null;
  readonly tokens: number | null;
  readonly subagent_count: number;
  readonly notification_ids_json: string;
  readonly error: string | null;
}

const TriggerJson = Schema.fromJsonString(
  Schema.Struct({ type: Schema.String, summary: Schema.String }),
);
const decodeTrigger = Schema.decodeUnknownOption(TriggerJson);
const encodeTrigger = Schema.encodeSync(TriggerJson);
const decodeNotificationIds = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);
const decodeUsage = Schema.decodeUnknownOption(Schema.fromJsonString(TurnTokenUsage));

/** Inserts a run and prunes the task's history beyond the retention limit. */
export const startRun = Effect.fn("ScheduledTaskRunHistory.startRun")(function* (input: {
  readonly id: ScheduledTaskRunId;
  readonly taskId: ScheduledTaskId;
  readonly startedAt: string;
  readonly trigger: RunTrigger;
  readonly status?: "running" | "skipped";
}) {
  const sql = yield* SqlClient.SqlClient;
  const status = input.status ?? "running";
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`INSERT INTO scheduled_task_runs ${sql.insert({
        id: input.id,
        task_id: input.taskId,
        started_at: input.startedAt,
        ended_at: status === "running" ? null : input.startedAt,
        status,
        trigger_json: encodeTrigger(input.trigger),
      })}`;
      yield* sql`DELETE FROM scheduled_task_runs WHERE task_id = ${input.taskId} AND id NOT IN (
        SELECT id FROM scheduled_task_runs WHERE task_id = ${input.taskId}
        ORDER BY started_at DESC, rowid DESC LIMIT ${RUN_RETENTION_PER_TASK})`;
    }),
  );
});

export const bindDispatch = Effect.fn("ScheduledTaskRunHistory.bindDispatch")(function* (
  id: ScheduledTaskRunId,
  threadId: ThreadId,
  messageId: MessageId,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE scheduled_task_runs SET thread_id = ${threadId}, message_id = ${messageId}
    WHERE id = ${id}`;
});

export const bindOrchestrationRun = Effect.fn("ScheduledTaskRunHistory.bindOrchestrationRun")(
  function* (id: ScheduledTaskRunId, runId: RunId) {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE scheduled_task_runs SET orchestration_run_id = ${runId} WHERE id = ${id}`;
  },
);

/** Closes a run once; a run already closed keeps its first outcome. */
export const finishRun = Effect.fn("ScheduledTaskRunHistory.finishRun")(function* (
  id: ScheduledTaskRunId,
  outcome: {
    readonly status: Exclude<ScheduledTaskRunOutcome, "running">;
    readonly endedAt: string;
    readonly error: string | null;
    readonly costUsd?: number | null;
    readonly tokens?: number | null;
  },
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE scheduled_task_runs
    SET status = ${outcome.status}, ended_at = ${outcome.endedAt}, error = ${outcome.error},
        cost_usd = ${outcome.costUsd ?? null}, tokens = ${outcome.tokens ?? null}
    WHERE id = ${id} AND ended_at IS NULL`;
});

export const deleteRun = Effect.fn("ScheduledTaskRunHistory.deleteRun")(function* (
  id: ScheduledTaskRunId,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM scheduled_task_runs WHERE id = ${id}`;
});

/** Runs a previous server process left open. */
export const openRuns = Effect.fn("ScheduledTaskRunHistory.openRuns")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    id: string;
    task_id: string;
    started_at: string;
    thread_id: string | null;
    message_id: string | null;
  }>`SELECT id, task_id, started_at, thread_id, message_id FROM scheduled_task_runs
    WHERE ended_at IS NULL`;
  return rows.map((row) => ({
    id: ScheduledTaskRunId.make(row.id),
    taskId: ScheduledTaskId.make(row.task_id),
    startedAt: row.started_at,
    threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
    messageId: row.message_id === null ? null : MessageId.make(row.message_id),
  }));
});

/**
 * Token totals and priceable records for one orchestration run's provider turns. `otherUsage`
 * (native subagents, compaction) is priced at the main agent's model, an approximation.
 */
export const runUsage = Effect.fn("ScheduledTaskRunHistory.runUsage")(function* (
  threadId: ThreadId,
  runId: RunId,
) {
  const sql = yield* SqlClient.SqlClient;
  const turns = yield* sql<{ usage_json: string | null; model: string | null }>`
    SELECT json_extract(t.payload_json, '$.turnTokenUsage') AS usage_json,
      json_extract(t.payload_json, '$.model') AS model
    FROM orchestration_v2_projection_provider_turns t
    JOIN orchestration_v2_projection_run_attempts a ON a.attempt_id = t.run_attempt_id
    WHERE t.thread_id = ${threadId} AND a.run_id = ${runId}`.pipe(NodeSqliteClient.readOnly);
  let tokens: number | null = null;
  const records: Array<PricedRecord> = [];
  for (const turn of turns) {
    const usage = turn.usage_json === null ? Option.none() : decodeUsage(turn.usage_json);
    if (Option.isNone(usage)) continue;
    const { inputTokens = 0, outputTokens = 0, otherUsage } = usage.value;
    const cached = usage.value.cachedInputTokens ?? 0;
    const cacheCreation = usage.value.cacheCreationTokens ?? 0;
    tokens =
      (tokens ?? 0) +
      inputTokens +
      outputTokens +
      (otherUsage?.inputTokens ?? 0) +
      (otherUsage?.outputTokens ?? 0);
    const model = usage.value.models?.[0] ?? turn.model;
    if (model === null) continue;
    records.push({
      model,
      totals: {
        uncachedInputTokens:
          Math.max(0, inputTokens - cached - cacheCreation) + (otherUsage?.inputTokens ?? 0),
        cachedInputTokens: cached,
        cacheCreationTokens: cacheCreation,
        outputTokens: outputTokens + (otherUsage?.outputTokens ?? 0),
        reasoningTokens: usage.value.reasoningTokens ?? 0,
      },
      speed: "standard",
      reportedCostUsd: null,
    });
  }
  return { tokens, records };
});

const decodeRun = (row: RunRow): ScheduledTaskRun => {
  const trigger = Option.getOrElse(decodeTrigger(row.trigger_json), () => ({
    type: "unknown",
    summary: "",
  }));
  return {
    id: ScheduledTaskRunId.make(row.id),
    taskId: ScheduledTaskId.make(row.task_id),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    trigger,
    threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
    messageId: row.message_id === null ? null : MessageId.make(row.message_id),
    ...(row.cost_usd === null ? {} : { costUsd: row.cost_usd }),
    ...(row.tokens === null ? {} : { tokens: row.tokens }),
    ...(row.subagent_count > 0 ? { subagents: row.subagent_count } : {}),
    notifications: Option.getOrElse(decodeNotificationIds(row.notification_ids_json), () => []),
    error: row.error,
  };
};

/** Newest first, one page at a time. */
export const listRuns = Effect.fn("ScheduledTaskRunHistory.listRuns")(function* (
  taskId: ScheduledTaskId,
  before: ScheduledTaskRunId | undefined,
) {
  const sql = yield* SqlClient.SqlClient;
  const cursor =
    before === undefined
      ? sql``
      : sql`AND (started_at, rowid) < (SELECT started_at, rowid FROM scheduled_task_runs
          WHERE id = ${before} AND task_id = ${taskId})`;
  const rows = yield* sql<RunRow>`SELECT * FROM scheduled_task_runs
    WHERE task_id = ${taskId} ${cursor}
    ORDER BY started_at DESC, rowid DESC LIMIT ${RUNS_PAGE_SIZE + 1}`.pipe(
    NodeSqliteClient.readOnly,
  );
  const result: ScheduledTaskListRunsResult = {
    runs: rows.slice(0, RUNS_PAGE_SIZE).map(decodeRun),
    hasMore: rows.length > RUNS_PAGE_SIZE,
  };
  return result;
});
