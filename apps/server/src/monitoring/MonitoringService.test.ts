import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  MonitoringError,
  MonitoringProfileId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskError,
  type MonitoringUpsertInput,
} from "@t3tools/contracts";
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
