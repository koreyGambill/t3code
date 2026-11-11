import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  MonitoringError,
  MonitoringProfileId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskError,
  ScheduledTaskId,
  type ScheduledTask,
  type MonitoringUpsertInput,
  type OrchestrationV2DomainEvent,
  type MonitoringProfile,
  type MonitoringRun,
  ThreadId,
  RunId,
  MessageId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Tasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as Runner from "./MonitoringRunner.ts";
import * as Store from "./MonitoringStore.ts";
import * as Service from "./MonitoringService.ts";

const input: MonitoringUpsertInput = {
  title: "Standards",
  enabled: true,
  projectId: ProjectId.make("project:test"),
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "haiku" },
  schedule: { type: "interval", everyMs: 60000 },
  targets: {
    state: "active",
    threadIds: [],
    includeChildren: true,
    minAgeMs: 0,
    updatedWithinMs: null,
  },
  rules: [{ id: "verify", title: "Verify", instructions: "Require observed evidence." }],
};

it.effect(
  "rolls back profile writes when schedule persistence fails and rejects unavailable models before writing",
  () =>
    Effect.gen(function* () {
      const store = yield* Store.MonitoringStore;
      const scheduleFailure = Service.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Store.MonitoringStore, store),
            Layer.mock(Runner.MonitoringRunner)({ validateModel: () => Effect.void }),
            Layer.mock(Threads.ThreadManagementService)({ streamDomainEvents: Stream.empty }),
            Layer.mock(Tasks.ScheduledTaskService)({
              upsert: () => Effect.fail(new ScheduledTaskError({ message: "rejected" })),
            }),
          ),
        ),
      );
      const result = yield* Effect.result(
        Effect.flatMap(Service.MonitoringService, (service) => service.upsert(input)).pipe(
          Effect.provide(scheduleFailure),
        ),
      );
      assert.equal(result._tag, "Failure");
      assert.deepEqual((yield* store.list()).profiles, []);
      const unavailable = Service.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Store.MonitoringStore, store),
            Layer.mock(Runner.MonitoringRunner)({
              validateModel: () =>
                Effect.fail(new MonitoringError({ operation: "selected model unavailable" })),
            }),
            Layer.mock(Threads.ThreadManagementService)({ streamDomainEvents: Stream.empty }),
            Layer.mock(Tasks.ScheduledTaskService)({}),
          ),
        ),
      );
      const rejected = yield* Effect.result(
        Effect.flatMap(Service.MonitoringService, (service) => service.upsert(input)).pipe(
          Effect.provide(unavailable),
        ),
      );
      assert.equal(rejected._tag, "Failure");
      assert.equal(yield* store.getProfile(MonitoringProfileId.make("missing")), null);
      const sql = yield* SqlClient.SqlClient;
      assert.equal(
        (yield* sql<{ count: number }>`SELECT count(*) AS count FROM monitoring_profiles`)[0]
          ?.count,
        0,
      );
    }).pipe(
      Effect.provide(
        Layer.merge(NodeCrypto.layer, Store.layer.pipe(Layer.provideMerge(Sqlite.layerMemory))),
      ),
    ),
);

it.effect(
  "counts only open unread findings whose snooze expired without loading report bodies",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      for (const [id, disposition, readAt, snoozedUntil] of [
        ["unread", "open", null, null],
        ["expired", "open", null, "1969-12-31T23:59:59Z"],
        ["snoozed", "open", null, "2099-01-01T00:00:00Z"],
        ["read", "open", "1970-01-01T00:00:00Z", null],
        ["dismissed", "dismissed", null, null],
      ]) {
        const payload = JSON.stringify({ disposition, readAt, snoozedUntil });
        yield* sql`INSERT INTO monitoring_findings (id,profile_id,thread_id,updated_at,payload_json) VALUES (${id},'profile','thread','1970-01-01T00:00:00Z',${payload})`;
      }
      assert.deepEqual(yield* (yield* Store.MonitoringStore).status(), { unreadCount: 2 });
    }).pipe(Effect.provide(Store.layer.pipe(Layer.provideMerge(Sqlite.layerMemory)))),
);

it.effect(
  "creates context review schedules paused even when creation asks to enable, then permits explicit opt-in",
  () =>
    Effect.gen(function* () {
      const store = yield* Store.MonitoringStore;
      let scheduleEnabled: boolean | undefined;
      const task: ScheduledTask = {
        id: ScheduledTaskId.make("schedule"),
        title: "Review",
        prompt: "Review",
        enabled: false,
        schedule: input.schedule,
        projectId: input.projectId,
        threadId: null,
        workspaceStrategy: { type: "root" },
        modelSelection: input.modelSelection,
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdBy: "system",
        creationSource: "server",
        createdAt: "2026-11-09T00:00:00Z",
        updatedAt: "2026-11-09T00:00:00Z",
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: "never",
        lastRunError: null,
        runCount: 0,
      };
      const serviceLayer = Service.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Store.MonitoringStore, store),
            Layer.mock(Runner.MonitoringRunner)({ validateModel: () => Effect.void }),
            Layer.mock(Threads.ThreadManagementService)({ streamDomainEvents: Stream.empty }),
            Layer.mock(Tasks.ScheduledTaskService)({
              upsert: (schedule) => {
                scheduleEnabled = schedule.enabled;
                return Effect.succeed({ task: { ...task, enabled: schedule.enabled } });
              },
              setEnabled: (schedule) => {
                scheduleEnabled = schedule.enabled;
                return Effect.succeed({ task: { ...task, enabled: schedule.enabled } });
              },
            }),
          ),
        ),
      );
      const service = yield* Service.MonitoringService.pipe(Effect.provide(serviceLayer));
      const saved = yield* service.upsert({ ...input, kind: "context-review", enabled: true });
      assert.equal(saved.profile.enabled, false);
      assert.equal(scheduleEnabled, false);
      const optedIn = yield* service.setEnabled({ id: saved.profile.id, enabled: true });
      assert.equal(optedIn.profile.enabled, true);
      assert.equal(scheduleEnabled, true);
    }).pipe(
      Effect.provide(
        Layer.merge(NodeCrypto.layer, Store.layer.pipe(Layer.provideMerge(Sqlite.layerMemory))),
      ),
    ),
);

it.effect(
  "reviews only terminal turns, off the event fiber, with cooldown and in-flight guards",
  () =>
    Effect.gen(function* () {
      const selected: MonitoringProfile = {
        ...input,
        id: MonitoringProfileId.make("watcher"),
        scheduledTaskId: ScheduledTaskId.make("monitoring:watcher"),
        createdAt: "1970-01-01T00:00:00Z",
        updatedAt: "1970-01-01T00:00:00Z",
        turnEnd: {},
      };
      const store = yield* Store.MonitoringStore;
      yield* store.saveProfile(selected);
      const sql = yield* SqlClient.SqlClient;
      const at = selected.createdAt;
      yield* sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES ('thread',${selected.projectId},'Thread','claude','full-access','default',${at},${at},'{}')`;
      const events = yield* Queue.unbounded<{
        event: OrchestrationV2DomainEvent;
        processed: Deferred.Deferred<void>;
      }>();
      const entered = yield* Queue.unbounded<ThreadId>();
      const release = yield* Deferred.make<void>();
      let calls = 0;
      const ranProfiles: Array<MonitoringProfileId> = [];
      const stream = Stream.fromQueue(events).pipe(
        Stream.flatMap(({ event, processed }) =>
          Stream.make(event).pipe(
            Stream.concat(
              Stream.fromEffect(Deferred.succeed(processed, undefined)).pipe(Stream.drain),
            ),
          ),
        ),
      );
      const serviceLayer = Service.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Store.MonitoringStore, store),
            Layer.mock(Threads.ThreadManagementService)({ streamDomainEvents: stream }),
            Layer.mock(Tasks.ScheduledTaskService)({}),
            Layer.mock(Runner.MonitoringRunner)({
              run: (id, threadId) =>
                Effect.gen(function* () {
                  calls++;
                  ranProfiles.push(id);
                  yield* Queue.offer(entered, threadId!);
                  if (calls > 1) yield* Deferred.await(release);
                  return {} as MonitoringRun;
                }),
            }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        yield* Service.MonitoringService;
        const emit = Effect.fn("test.emit")(function* (status: "running" | "completed") {
          const processed = yield* Deferred.make<void>();
          yield* Queue.offer(events, {
            processed,
            event: {
              type: "run.updated",
              payload: {
                id: RunId.make("run"),
                threadId: ThreadId.make("thread"),
                userMessageId: MessageId.make("user"),
                status,
              },
              occurredAt: DateTime.makeUnsafe(0),
            } as OrchestrationV2DomainEvent,
          });
          yield* Deferred.await(processed);
        });
        yield* emit("running");
        assert.equal(calls, 0);
        yield* store.saveProfile({ ...selected, enabled: false });
        yield* emit("completed");
        assert.equal(calls, 0);
        yield* store.saveProfile({ ...selected, projectId: ProjectId.make("other") });
        yield* emit("completed");
        assert.equal(calls, 0);
        yield* store.saveProfile(selected);
        yield* sql`UPDATE orchestration_v2_projection_threads SET archived_at=${at} WHERE thread_id='thread'`;
        yield* emit("completed");
        assert.equal(calls, 0);
        yield* sql`UPDATE orchestration_v2_projection_threads SET archived_at=NULL, deleted_at=${at} WHERE thread_id='thread'`;
        yield* emit("completed");
        assert.equal(calls, 0);
        yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at=NULL WHERE thread_id='thread'`;
        for (const message of [
          { origin: { kind: "system", event: "monitoring advisory" } },
          { scheduledTaskId: "monitoring:watcher" },
        ]) {
          const payload = JSON.stringify(message);
          yield* sql`INSERT OR REPLACE INTO orchestration_v2_projection_messages(message_id,thread_id,role,streaming,created_at,updated_at,payload_json) VALUES ('user','thread','user',0,${at},${at},${payload})`;
          yield* emit("completed");
          assert.equal(calls, 0);
        }
        yield* sql`INSERT INTO scheduled_tasks(task_id,title,prompt,enabled,schedule_json,project_id,workspace_strategy_json,model_selection_json,runtime_mode,interaction_mode,created_by,creation_source,created_at,updated_at,last_run_status,run_count) VALUES ('idle','Idle','check',1,'{"type":"interval","everyMs":60000,"idleCheckin":true}',${selected.projectId},'{}','{}','full-access','default','system','server',${at},${at},'never',0)`;
        yield* sql`UPDATE orchestration_v2_projection_messages SET payload_json='{"scheduledTaskId":"idle","origin":{"kind":"scheduled-task","title":"Idle"}}' WHERE message_id='user'`;
        yield* emit("completed");
        assert.equal(calls, 0);
        yield* sql`DELETE FROM orchestration_v2_projection_messages WHERE message_id='user'`;
        yield* emit("completed");
        assert.equal(yield* Queue.take(entered), "thread");
        yield* emit("completed");
        assert.equal(calls, 1);
        yield* TestClock.adjust("11 minutes");
        yield* emit("completed");
        assert.equal(yield* Queue.take(entered), "thread");
        assert.equal(calls, 2);
        yield* TestClock.adjust("11 minutes");
        yield* emit("completed");
        assert.equal(calls, 2);
        yield* Deferred.succeed(release, undefined);
        yield* store.saveProfile({ ...selected, enabled: false });
        yield* store.saveProfile({
          ...selected,
          id: MonitoringProfileId.make("everywhere"),
          scheduledTaskId: ScheduledTaskId.make("monitoring:everywhere"),
          projectId: ProjectId.make("other"),
          turnEnd: { allProjects: true },
        });
        yield* emit("completed");
        assert.equal(yield* Queue.take(entered), "thread");
        assert.equal(ranProfiles.at(-1), "everywhere");
      }).pipe(Effect.provide(serviceLayer));
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.merge(NodeCrypto.layer, Store.layer.pipe(Layer.provideMerge(Sqlite.layerMemory))),
      ),
    ),
);
