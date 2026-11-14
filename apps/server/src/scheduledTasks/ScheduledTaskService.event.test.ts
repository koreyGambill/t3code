import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskUpsertInput,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as StatusSources from "../statusSources/StatusSources.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const decode = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);
const input = {
  title: "React",
  prompt: "Look at what happened.",
  enabled: true,
  projectId: "project:test",
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: "codex", model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
};

const fixture = Effect.gen(function* () {
  // A PubSub, like the real streams: the idle check-in listener subscribes to the same events.
  const events = yield* PubSub.unbounded<OrchestrationV2DomainEvent>({ replay: 64 });
  const transitions = yield* PubSub.unbounded<StatusSources.StatusSourceTransition>({ replay: 64 });
  const tick = yield* Ref.make<Effect.Effect<void>>(Effect.void);
  const launches = yield* Ref.make<ReadonlyArray<string>>([]);
  const scheduler: Scheduler.Scheduler["Service"] = {
    register: <E, R>(name: string, run: Effect.Effect<void, E, R>) =>
      Effect.gen(function* () {
        const context = yield* Effect.context<R>();
        if (name === "scheduled-tasks")
          yield* Ref.set(tick, run.pipe(Effect.provideContext(context), Effect.orDie));
      }),
  };
  const layer = ScheduledTaskService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeCrypto.layer,
        ManagedPolicy.layerTest(),
        Layer.succeed(Scheduler.Scheduler, scheduler),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          launch: (request) =>
            Ref.modify(launches, (all) => [
              { threadId: ThreadId.make(`thread:launched-${all.length + 1}`), resumed: false },
              [...all, request.initialMessage?.text ?? ""],
            ]) as never,
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          streamDomainEvents: Stream.fromPubSub(events),
          getThreadRecords: () => Effect.succeed({ runs: [], messages: [] } as never),
        }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () => Effect.succeed(false),
        }),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(StatusSources.StatusSources)({ transitions: Stream.fromPubSub(transitions) }),
      ),
    ),
  );
  return { events, transitions, tick: Ref.get(tick).pipe(Effect.flatten), launches, layer };
});

type Fixture = Effect.Success<typeof fixture>;

/**
 * Runs `body` with the service and `queued(subject, key)`, which waits until the reactor has queued
 * that event. List changes can coalesce, so it checks stored state after each one.
 */
const withService = <A, E, R>(
  f: Fixture,
  body: (
    service: ScheduledTaskService.ScheduledTaskService["Service"],
    queued: (
      subject: string,
      keyPrefix: string,
    ) => Effect.Effect<void, SqlError, SqlClient.SqlClient>,
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const service = yield* ScheduledTaskService.ScheduledTaskService;
    const updates = yield* Queue.unbounded<unknown>();
    yield* service.subscribeList().pipe(
      Stream.runForEach((list) => Queue.offer(updates, list)),
      Effect.forkScoped,
    );
    const queued = (subject: string, keyPrefix: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const isQueued = sql`SELECT 1 FROM scheduled_task_event_subjects WHERE subject = ${subject}
          AND (event_key LIKE ${`${keyPrefix}%`} OR last_event_key LIKE ${`${keyPrefix}%`})`.pipe(
          Effect.map((rows) => rows.length > 0),
        );
        while (!(yield* isQueued)) yield* Queue.take(updates);
      });
    return yield* body(service, queued);
  }).pipe(Effect.provide(f.layer));

const insertThread = (threadId: string, projectId = "project:test", parent: string | null = null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title,
      default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
      VALUES (${threadId}, ${projectId}, 'Thread', 'codex', 'full-access', 'default',
        '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z',
        ${JSON.stringify({ lineage: { parentThreadId: parent } })})`;
  });

const runEnded = (runId: string, threadId: string, userMessageId = `message:${runId}`) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const run: OrchestrationV2Run = {
      id: RunId.make(runId),
      threadId: ThreadId.make(threadId),
      ordinal: 1,
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      providerThreadId: null,
      userMessageId: MessageId.make(userMessageId),
      rootNodeId: null,
      activeAttemptId: null,
      status: "completed",
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      checkpointId: null,
      contextHandoffId: null,
    };
    return {
      id: EventId.make(`event:${runId}`),
      type: "run.updated",
      threadId: run.threadId,
      runId: run.id,
      occurredAt: now,
      payload: run,
    } satisfies OrchestrationV2DomainEvent;
  });

const threadEvent = (
  type: "thread.created" | "thread.settled",
  threadId: string,
  parent: string | null = null,
) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    return {
      id: EventId.make(`event:${type}:${threadId}`),
      type,
      threadId: ThreadId.make(threadId),
      occurredAt: now,
      payload: {
        id: ThreadId.make(threadId),
        projectId: "project:test",
        title: `Thread ${threadId}`,
        lineage: { parentThreadId: parent, relationshipToParent: null, rootThreadId: threadId },
        settledAt: type === "thread.settled" ? now : null,
      },
    } as unknown as OrchestrationV2DomainEvent;
  });

it.effect("run_ended fires once per run, only for matching threads", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* insertThread("thread:a");
    yield* insertThread("thread:b");
    yield* insertThread("thread:elsewhere", "project:other");
    yield* withService(f, (service, queued) =>
      Effect.gen(function* () {
        const { task } = yield* service.upsert(
          yield* decode({
            ...input,
            schedule: { type: "event", event: "run_ended", projectId: "project:test" },
          }),
        );
        expect(task.nextRunAt).toBeNull();
        yield* PubSub.publish(f.events, yield* runEnded("run:elsewhere", "thread:elsewhere"));
        yield* PubSub.publish(f.events, yield* runEnded("run:a", "thread:a"));
        yield* queued("thread:a", "run:run:a");
        yield* f.tick;
        const [prompt] = yield* Ref.get(f.launches);
        expect(prompt).toContain("Look at what happened.");
        expect(prompt).toContain("A turn ended (completed) on thread thread:a.");
        // A replayed terminal update for the same run does not fire again.
        yield* PubSub.publish(f.events, yield* runEnded("run:a", "thread:a"));
        yield* PubSub.publish(f.events, yield* runEnded("run:b", "thread:b"));
        yield* queued("thread:b", "run:run:b");
        yield* f.tick;
        const launches = yield* Ref.get(f.launches);
        expect(launches).toHaveLength(2);
        expect(launches[1]).toContain("thread:b");
        const [stored] = (yield* service.list()).tasks;
        expect(stored).toMatchObject({ runCount: 2, lastRunStatus: "succeeded", nextRunAt: null });
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a task's own turns and threads never retrigger it", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const sql = yield* SqlClient.SqlClient;
    yield* insertThread("thread:a");
    yield* insertThread("thread:c");
    yield* insertThread("thread:launched-1");
    yield* insertThread("thread:launched-child", "project:test", "thread:launched-1");
    yield* withService(f, (service, queued) =>
      Effect.gen(function* () {
        const { task } = yield* service.upsert(
          yield* decode({ ...input, schedule: { type: "event", event: "run_ended" } }),
        );
        yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, role,
          streaming, created_at, updated_at, payload_json)
          VALUES ('message:from-task', 'thread:a', 'user', 0, '1970-01-01T00:00:00.000Z',
            '1970-01-01T00:00:00.000Z', ${JSON.stringify({ scheduledTaskId: task.id })})`;
        yield* PubSub.publish(f.events, yield* runEnded("run:a", "thread:a", "message:user"));
        yield* queued("thread:a", "run:run:a");
        yield* f.tick;
        expect(yield* Ref.get(f.launches)).toHaveLength(1);
        yield* PubSub.publish(f.events, yield* runEnded("run:launched", "thread:launched-1"));
        yield* PubSub.publish(f.events, yield* runEnded("run:child", "thread:launched-child"));
        yield* PubSub.publish(
          f.events,
          yield* runEnded("run:own", "thread:a", "message:from-task"),
        );
        yield* PubSub.publish(f.events, yield* runEnded("run:c", "thread:c"));
        yield* queued("thread:c", "run:run:c");
        yield* f.tick;
        const launches = yield* Ref.get(f.launches);
        expect(launches).toHaveLength(2);
        expect(launches[1]).toContain("thread:c");
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("coalesces events per thread and waits out each thread's cooldown", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* insertThread("thread:a");
    yield* insertThread("thread:b");
    yield* withService(f, (service, queued) =>
      Effect.gen(function* () {
        yield* service.upsert(
          yield* decode({
            ...input,
            schedule: {
              type: "event",
              event: "run_ended",
              cooldownSeconds: 600,
              coalesceSeconds: 60,
            },
          }),
        );
        yield* PubSub.publish(f.events, yield* runEnded("run:a1", "thread:a"));
        yield* queued("thread:a", "run:run:a1");
        yield* f.tick;
        yield* TestClock.adjust("59 seconds");
        yield* PubSub.publish(f.events, yield* runEnded("run:a2", "thread:a"));
        yield* queued("thread:a", "run:run:a2");
        yield* f.tick;
        expect(yield* Ref.get(f.launches)).toHaveLength(0);
        yield* TestClock.adjust("1 second");
        yield* f.tick;
        const [coalesced] = yield* Ref.get(f.launches);
        expect(coalesced).toContain("1 earlier event(s) were coalesced");

        // Thread a is cooling down until 600s after that run; thread b is not.
        yield* PubSub.publish(f.events, yield* runEnded("run:a3", "thread:a"));
        yield* queued("thread:a", "run:run:a3");
        yield* PubSub.publish(f.events, yield* runEnded("run:b1", "thread:b"));
        yield* queued("thread:b", "run:run:b1");
        yield* TestClock.adjust("60 seconds");
        yield* f.tick;
        const afterWindow = yield* Ref.get(f.launches);
        expect(afterWindow).toHaveLength(2);
        expect(afterWindow[1]).toContain("thread:b");
        yield* TestClock.adjust("8 minutes");
        yield* f.tick;
        expect(yield* Ref.get(f.launches)).toHaveLength(2);
        yield* TestClock.adjust("1 minute");
        yield* f.tick;
        const afterCooldown = yield* Ref.get(f.launches);
        expect(afterCooldown).toHaveLength(3);
        expect(afterCooldown[2]).toContain("thread:a");
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("thread_created matches watched threads and their descendants", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* insertThread("thread:root");
    yield* insertThread("thread:child", "project:test", "thread:root");
    yield* withService(f, (service, queued) =>
      Effect.gen(function* () {
        yield* service.upsert(
          yield* decode({
            ...input,
            schedule: {
              type: "event",
              event: "thread_created",
              threadIds: ["thread:root"],
              includeDescendants: true,
            },
          }),
        );
        yield* PubSub.publish(f.events, yield* threadEvent("thread.created", "thread:unrelated"));
        yield* PubSub.publish(
          f.events,
          yield* threadEvent("thread.created", "thread:grandchild", "thread:child"),
        );
        yield* queued("thread:grandchild", "created:thread:grandchild");
        yield* f.tick;
        const launches = yield* Ref.get(f.launches);
        expect(launches).toHaveLength(1);
        expect(launches[0]).toContain(
          'Thread "Thread thread:grandchild" (thread:grandchild) was created.',
        );
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("thread_settled fires for a settled thread", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* withService(f, (service, queued) =>
      Effect.gen(function* () {
        yield* service.upsert(
          yield* decode({ ...input, schedule: { type: "event", event: "thread_settled" } }),
        );
        yield* PubSub.publish(f.events, yield* threadEvent("thread.created", "thread:a"));
        yield* PubSub.publish(f.events, yield* threadEvent("thread.settled", "thread:a"));
        yield* queued("thread:a", "settled:thread:a");
        yield* f.tick;
        const launches = yield* Ref.get(f.launches);
        expect(launches).toHaveLength(1);
        expect(launches[0]).toContain("(thread:a) settled.");
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("status_transition filters by source and target state", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* withService(f, (service, queued) =>
      Effect.gen(function* () {
        yield* service.upsert(
          yield* decode({
            ...input,
            schedule: {
              type: "event",
              event: "status_transition",
              statusSource: "ci",
              toState: "fail",
            },
          }),
        );
        const transition = (sourceId: string, to: "warn" | "fail", at: string) => ({
          sourceId,
          name: sourceId.toUpperCase(),
          from: "ok" as const,
          to,
          at,
        });
        yield* PubSub.publish(f.transitions, transition("ci", "warn", "1970-01-01T00:00:01.000Z"));
        yield* PubSub.publish(
          f.transitions,
          transition("deploy", "fail", "1970-01-01T00:00:02.000Z"),
        );
        yield* PubSub.publish(f.transitions, transition("ci", "fail", "1970-01-01T00:00:03.000Z"));
        yield* queued("status:ci", "status:ci:1970-01-01T00:00:03");
        yield* f.tick;
        const launches = yield* Ref.get(f.launches);
        expect(launches).toHaveLength(1);
        expect(launches[0]).toContain('Status source "CI" (ci) changed from ok to fail.');
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("rejects filters that do not apply to the event", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* withService(f, (service) =>
      Effect.gen(function* () {
        const error = yield* service
          .upsert(
            yield* decode({
              ...input,
              schedule: { type: "event", event: "status_transition", threadIds: ["thread:a"] },
            }),
          )
          .pipe(Effect.flip);
        expect(error.message).toContain("statusSource and toState only");
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
