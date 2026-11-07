import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  MonitoringProfileId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  type MonitoringProfile,
  type MonitoringRun,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as ServerConfig from "../config.ts";
import * as Registry from "../provider/ProviderInstanceRegistry.ts";
import * as Delivery from "./MonitoringDelivery.ts";
import * as Runner from "./MonitoringRunner.ts";
import * as Snapshot from "./MonitoringSnapshot.ts";
import * as Store from "./MonitoringStore.ts";

const profile: MonitoringProfile = {
  id: MonitoringProfileId.make("watcher"),
  scheduledTaskId: ScheduledTaskId.make("monitoring:watcher"),
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
  createdAt: "2026-11-07T00:00:00Z",
  updatedAt: "2026-11-07T00:00:00Z",
};

it.effect(
  "records failed runs for an unavailable explicit model without choosing another provider",
  () =>
    Effect.gen(function* () {
      const saved = yield* Ref.make<ReadonlyArray<MonitoringRun>>([]);
      const layer = Runner.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(Store.MonitoringStore)({
              getProfile: () => Effect.succeed(profile),
              saveRun: (run) => Ref.update(saved, (runs) => [...runs, run]),
            }),
            Layer.mock(Snapshot.MonitoringSnapshot)({}),
            Layer.mock(Delivery.MonitoringDelivery)({}),
            Layer.mock(Registry.ProviderInstanceRegistry)({ getInstance: () => Effect.undefined }),
            ServerConfig.layerTest("/workspace", { prefix: "t3-monitor-runner-" }),
          ),
        ),
        Layer.provide(Layer.merge(NodeCrypto.layer, NodeServices.layer)),
      );
      const result = yield* Effect.flatMap(Runner.MonitoringRunner, (runner) =>
        runner.run(profile.id),
      ).pipe(Effect.provide(layer));
      assert.equal(result.status, "failed");
      assert.equal(result.profile.modelSelection.model, "haiku");
      assert.equal(result.completedAt !== null, true);
      assert.deepEqual(
        (yield* Ref.get(saved)).map((run) => run.status),
        ["running", "failed"],
      );
    }).pipe(Effect.scoped),
);

it.effect("claims a profile before asynchronous lookup and releases it when interrupted", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const layer = Runner.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(Store.MonitoringStore)({
            getProfile: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as(profile),
              ),
            saveRun: () => Effect.void,
          }),
          Layer.mock(Snapshot.MonitoringSnapshot)({}),
          Layer.mock(Delivery.MonitoringDelivery)({}),
          Layer.mock(Registry.ProviderInstanceRegistry)({ getInstance: () => Effect.undefined }),
          ServerConfig.layerTest("/workspace", { prefix: "t3-monitor-runner-" }),
        ),
      ),
      Layer.provide(Layer.merge(NodeCrypto.layer, NodeServices.layer)),
    );
    yield* Effect.gen(function* () {
      const runner = yield* Runner.MonitoringRunner;
      const first = yield* runner.run(profile.id).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const duplicate = yield* Effect.result(runner.run(profile.id));
      assert.equal(duplicate._tag, "Failure");
      if (duplicate._tag === "Failure")
        assert.equal(duplicate.failure.operation, "profile already running");
      yield* Fiber.interrupt(first);
      yield* Deferred.succeed(release, undefined);
      assert.equal((yield* runner.run(profile.id)).status, "failed");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped),
);
