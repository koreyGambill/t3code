import {
  isListedThreadLineage,
  type OrchestrationV2DomainEvent,
  type ScheduledTaskEventKind,
  type ScheduledTaskEventSchedule,
  type ScheduledTaskId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import type { StatusSourceTransition } from "../statusSources/StatusSources.ts";

const TERMINAL_RUN = new Set(["completed", "failed", "cancelled", "interrupted", "rolled_back"]);
const TERMINAL_SUBAGENT = new Set(["completed", "failed", "cancelled", "interrupted"]);
// Dedupe keys outlive the cooldown by this much, so a replayed terminal update cannot fire twice.
const SUBJECT_RETENTION_MS = 24 * 60 * 60 * 1_000;

export interface EventFact {
  readonly kind: ScheduledTaskEventKind;
  /** Cooldown and coalescing are per subject: a thread id, or `status:<source id>`. */
  readonly subject: string;
  readonly key: string;
  readonly threadId: ThreadId | null;
  /** The thread's project and parent, when the event carries them. */
  readonly thread?: { readonly projectId: string; readonly parentId: string | null };
  readonly runUserMessageId?: string;
  readonly statusSource?: string;
  readonly toState?: string;
  readonly detail: string;
  readonly occurredAt: string;
}

const StoredEvent = Schema.Struct({ detail: Schema.String, occurredAt: Schema.String });
const encodeStoredEvent = Schema.encodeSync(Schema.fromJsonString(StoredEvent));
const decodeStoredEvent = Schema.decodeUnknownOption(Schema.fromJsonString(StoredEvent));

const iso = (value: DateTime.DateTime) => DateTime.formatIso(DateTime.toUtc(value));
const isoAfter = (value: string, ms: number) =>
  iso(DateTime.addDuration(DateTime.makeUnsafe(value), ms));

export function factFromDomainEvent(event: OrchestrationV2DomainEvent): EventFact | null {
  const occurredAt = iso(event.occurredAt);
  if (event.type === "run.updated" && TERMINAL_RUN.has(event.payload.status)) {
    const run = event.payload;
    return {
      kind: "run_ended",
      subject: run.threadId,
      key: `run:${run.id}`,
      threadId: run.threadId,
      runUserMessageId: run.userMessageId,
      detail: `A turn ended (${run.status}) on thread ${run.threadId}.`,
      occurredAt,
    };
  }
  if (event.type !== "thread.created" && event.type !== "thread.settled") return null;
  const thread = event.payload;
  if (!isListedThreadLineage(thread.lineage)) return null;
  const context = {
    projectId: thread.projectId,
    parentId: thread.lineage.parentThreadId ?? thread.delegatedFrom?.threadId ?? null,
  };
  return event.type === "thread.created"
    ? {
        kind: "thread_created",
        subject: thread.id,
        key: `created:${thread.id}`,
        threadId: thread.id,
        thread: context,
        detail: `Thread "${thread.title}" (${thread.id}) was created.`,
        occurredAt,
      }
    : {
        kind: "thread_settled",
        subject: thread.id,
        key: `settled:${thread.id}:${thread.settledAt === null ? occurredAt : iso(thread.settledAt)}`,
        threadId: thread.id,
        thread: context,
        detail: `Thread "${thread.title}" (${thread.id}) settled.`,
        occurredAt,
      };
}

export function factFromStatusTransition(transition: StatusSourceTransition): EventFact {
  return {
    kind: "status_transition",
    subject: `status:${transition.sourceId}`,
    key: `status:${transition.sourceId}:${transition.at}`,
    threadId: null,
    statusSource: transition.sourceId,
    toState: transition.to,
    detail: `Status source "${transition.name}" (${transition.sourceId}) changed from ${transition.from} to ${transition.to}.`,
    occurredAt: transition.at,
  };
}

/** Thread facts carry the thread's project and its ancestors, nearest first. */
function matchesEventSchedule(
  schedule: ScheduledTaskEventSchedule,
  fact: EventFact,
  thread: { readonly projectId: string | null; readonly lineage: ReadonlyArray<string> } | null,
): boolean {
  if (schedule.event !== fact.kind) return false;
  if (fact.kind === "status_transition") {
    return (
      (schedule.statusSource === undefined || schedule.statusSource === fact.statusSource) &&
      (schedule.toState === undefined || schedule.toState === fact.toState)
    );
  }
  if (thread === null) return false;
  if (schedule.projectId !== undefined && schedule.projectId !== thread.projectId) return false;
  if (schedule.threadIds === undefined || schedule.threadIds.length === 0) return true;
  const watched = new Set<string>(schedule.threadIds);
  return schedule.includeDescendants === true
    ? thread.lineage.some((id) => watched.has(id))
    : fact.threadId !== null && watched.has(fact.threadId);
}

function eventPromptSuffix(
  event: { readonly detail: string; readonly occurredAt: string },
  count: number,
) {
  const coalesced = count > 1 ? ` ${count - 1} earlier event(s) were coalesced into this run.` : "";
  return `\n\nTriggered by: ${event.detail} (${event.occurredAt}).${coalesced}`;
}

/** The thread's project and its ancestor chain, the thread itself first. */
const loadThreadContext = Effect.fn("ScheduledTaskEventTriggers.loadThreadContext")(function* (
  fact: EventFact,
) {
  const sql = yield* SqlClient.SqlClient;
  if (fact.threadId === null) return null;
  const start = fact.thread?.parentId ?? null;
  const [row] =
    fact.thread === undefined
      ? yield* sql<{ project_id: string; parent_id: string | null }>`
          SELECT project_id, COALESCE(json_extract(payload_json, '$.lineage.parentThreadId'),
            json_extract(payload_json, '$.delegatedFrom.threadId')) AS parent_id
          FROM orchestration_v2_projection_threads WHERE thread_id = ${fact.threadId}`
      : [{ project_id: fact.thread.projectId, parent_id: start }];
  if (row === undefined) return null;
  const ancestors =
    row.parent_id === null
      ? []
      : yield* sql<{ id: string }>`
          WITH RECURSIVE chain(id, depth) AS (
            SELECT ${row.parent_id}, 0
            UNION ALL
            SELECT COALESCE(json_extract(t.payload_json, '$.lineage.parentThreadId'),
              json_extract(t.payload_json, '$.delegatedFrom.threadId')), chain.depth + 1
            FROM chain JOIN orchestration_v2_projection_threads t ON t.thread_id = chain.id
            WHERE chain.depth < 32
          )
          SELECT id FROM chain WHERE id IS NOT NULL`;
  return {
    projectId: row.project_id,
    lineage: [fact.threadId, ...ancestors.map((ancestor) => ancestor.id)],
  };
});

interface CandidateTask {
  readonly id: ScheduledTaskId;
  readonly schedule: ScheduledTaskEventSchedule;
}

/**
 * Queue a fire for each enabled event task the fact matches. The run waits for the coalescing window
 * after the first event and for the subject's cooldown; later events replace the pending one.
 * Returns the tasks whose next run moved.
 */
export const recordEventFact = Effect.fn("ScheduledTaskEventTriggers.recordEventFact")(function* (
  fact: EventFact,
  candidates: ReadonlyArray<CandidateTask>,
  now: DateTime.DateTime,
) {
  const sql = yield* SqlClient.SqlClient;
  if (candidates.length === 0) return [];
  const thread = fact.threadId === null ? null : yield* loadThreadContext(fact);
  const matching = candidates.filter((task) => matchesEventSchedule(task.schedule, fact, thread));
  if (matching.length === 0) return [];
  const [origin] =
    fact.runUserMessageId === undefined
      ? []
      : yield* sql<{ task_id: string | null }>`
          SELECT json_extract(payload_json, '$.scheduledTaskId') AS task_id
          FROM orchestration_v2_projection_messages WHERE message_id = ${fact.runUserMessageId}`;
  const nowIso = iso(now);
  const lineage = thread?.lineage ?? [];
  const moved: ScheduledTaskId[] = [];
  for (const task of matching) {
    // A task's own turns and the threads it started never retrigger it.
    if (origin?.task_id === task.id) continue;
    const queued = yield* sql.withTransaction(
      Effect.gen(function* () {
        if (lineage.length > 0) {
          const owned = yield* sql`SELECT 1 FROM scheduled_task_event_subjects
            WHERE task_id = ${task.id} AND owned = 1 AND subject IN ${sql.in(lineage)}`;
          if (owned.length > 0) return false;
        }
        const [row] = yield* sql<{
          due_at: string | null;
          event_key: string | null;
          last_event_key: string | null;
          last_fired_at: string | null;
        }>`SELECT due_at, event_key, last_event_key, last_fired_at FROM scheduled_task_event_subjects
          WHERE task_id = ${task.id} AND subject = ${fact.subject}`;
        if (row?.event_key === fact.key || row?.last_event_key === fact.key) return false;
        const coalesceDue = isoAfter(nowIso, (task.schedule.coalesceSeconds ?? 0) * 1_000);
        const cooldownDue =
          row?.last_fired_at == null
            ? nowIso
            : isoAfter(row.last_fired_at, (task.schedule.cooldownSeconds ?? 0) * 1_000);
        const dueAt = row?.due_at ?? (coalesceDue > cooldownDue ? coalesceDue : cooldownDue);
        const event = encodeStoredEvent({ detail: fact.detail, occurredAt: fact.occurredAt });
        yield* sql`INSERT INTO scheduled_task_event_subjects
            (task_id, subject, due_at, event_key, event_json, event_count)
          VALUES (${task.id}, ${fact.subject}, ${dueAt}, ${fact.key}, ${event}, 1)
          ON CONFLICT (task_id, subject) DO UPDATE SET
            due_at = excluded.due_at, event_key = excluded.event_key,
            event_json = excluded.event_json, event_count = event_count + 1`;
        yield* sql`UPDATE scheduled_tasks SET next_run_at = ${dueAt}
          WHERE task_id = ${task.id} AND enabled = 1
            AND (next_run_at IS NULL OR next_run_at > ${dueAt})`;
        const retention = Math.max(
          SUBJECT_RETENTION_MS,
          (task.schedule.cooldownSeconds ?? 0) * 1_000,
        );
        yield* sql`DELETE FROM scheduled_task_event_subjects
          WHERE task_id = ${task.id} AND owned = 0 AND due_at IS NULL
            AND last_fired_at < ${isoAfter(nowIso, -retention)}`;
        return true;
      }),
    );
    if (queued) moved.push(task.id);
  }
  return moved;
});

/** Thread and task wakes are due as soon as the event they wait on happens. */
export const dueWakesForEvent = Effect.fn("ScheduledTaskEventTriggers.dueWakesForEvent")(function* (
  event: OrchestrationV2DomainEvent,
  now: DateTime.DateTime,
) {
  const sql = yield* SqlClient.SqlClient;
  const nowIso = iso(now);
  if (event.type === "run.updated" && TERMINAL_RUN.has(event.payload.status)) {
    return yield* sql`UPDATE scheduled_tasks SET next_run_at = ${nowIso}
        WHERE enabled = 1
          AND json_extract(schedule_json, '$.wakeWhen.type') = 'thread_finished'
          AND json_extract(schedule_json, '$.wakeWhen.threadId') = ${event.payload.threadId}
          AND (next_run_at IS NULL OR next_run_at > ${nowIso})
        RETURNING task_id`;
  }
  if (event.type === "subagent.updated" && TERMINAL_SUBAGENT.has(event.payload.status)) {
    return yield* sql`UPDATE scheduled_tasks SET next_run_at = ${nowIso}
        WHERE enabled = 1 AND thread_id = ${event.payload.threadId}
          AND json_extract(schedule_json, '$.wakeWhen.type') = 'task_finished'
          AND (next_run_at IS NULL OR next_run_at > ${nowIso})
        RETURNING task_id`;
  }
  return [];
});

/** Takes the earliest due event for a run; its subject's cooldown starts now. */
export const claimDueEvent = Effect.fn("ScheduledTaskEventTriggers.claimDueEvent")(function* (
  taskId: ScheduledTaskId,
  nowIso: string,
) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const [row] = yield* sql<{
        subject: string;
        event_key: string;
        event_json: string;
        event_count: number;
      }>`SELECT subject, event_key, event_json, event_count FROM scheduled_task_event_subjects
        WHERE task_id = ${taskId} AND due_at IS NOT NULL AND due_at <= ${nowIso}
        ORDER BY due_at, subject LIMIT 1`;
      if (row === undefined) return null;
      yield* sql`UPDATE scheduled_task_event_subjects
        SET due_at = NULL, event_key = NULL, event_json = NULL, event_count = 0,
          last_event_key = ${row.event_key}, last_fired_at = ${nowIso}
        WHERE task_id = ${taskId} AND subject = ${row.subject}`;
      const event = decodeStoredEvent(row.event_json);
      return {
        subject: row.subject,
        key: row.event_key,
        prompt: event._tag === "Some" ? eventPromptSuffix(event.value, row.event_count) : "",
      };
    }),
  );
});

export const pendingEventRunAt = Effect.fn("ScheduledTaskEventTriggers.pendingEventRunAt")(
  function* (taskId: ScheduledTaskId) {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ due_at: string | null }>`
      SELECT MIN(due_at) AS due_at FROM scheduled_task_event_subjects
      WHERE task_id = ${taskId} AND due_at IS NOT NULL`;
    return row?.due_at ?? null;
  },
);

/** Events in a thread this task launched, or its descendants, never trigger it again. */
export const markOwnedThread = Effect.fn("ScheduledTaskEventTriggers.markOwnedThread")(function* (
  taskId: ScheduledTaskId,
  threadId: ThreadId,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO scheduled_task_event_subjects (task_id, subject, owned)
    VALUES (${taskId}, ${threadId}, 1)
    ON CONFLICT (task_id, subject) DO UPDATE SET owned = 1, due_at = NULL,
      event_key = NULL, event_json = NULL, event_count = 0`;
});

export const clearPendingEvents = Effect.fn("ScheduledTaskEventTriggers.clearPendingEvents")(
  function* (taskId: ScheduledTaskId) {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE scheduled_task_event_subjects
      SET due_at = NULL, event_key = NULL, event_json = NULL, event_count = 0
      WHERE task_id = ${taskId} AND due_at IS NOT NULL`;
  },
);
