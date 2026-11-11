import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  MonitoringProfileId,
  MonitoringError,
  ThreadId,
  MessageId,
  TextGenerationError,
  type MonitoringFinding,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  type MonitoringProfile,
  type MonitoringRun,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
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

it.effect("skips unchanged context after a successful review and reviews fresh records", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const newest = yield* Ref.make("1970-01-01T00:00:00.000Z");
    const runs = yield* Ref.make<ReadonlyArray<MonitoringRun>>([]);
    const selected = { ...profile, kind: "context-review" as const };
    const layer = runnerLayer(
      selected,
      {
        list: () =>
          Ref.get(runs).pipe(Effect.map((runs) => ({ profiles: [selected], findings: [], runs }))),
        saveRun: (run) =>
          Ref.update(runs, (all) => [...all.filter((item) => item.id !== run.id), run]),
      },
      {
        capture: () =>
          Ref.get(newest).pipe(
            Effect.map((newestContextAt) => ({
              threads: [
                {
                  id: ThreadId.make("thread"),
                  title: "Main",
                  parentThreadId: null,
                  messages: [{ id: "context:run", role: "context record", text: "Repeated reads" }],
                },
              ],
              truncated: false,
              coverage: "Context records",
              newestContextAt,
            })),
          ),
      },
      () => Ref.update(calls, (n) => n + 1).pipe(Effect.as({ findings: [] })),
    );
    yield* Effect.gen(function* () {
      const runner = yield* Runner.MonitoringRunner;
      yield* runner.run(profile.id);
      yield* runner.run(profile.id);
      assert.equal(yield* Ref.get(calls), 1);
      yield* Ref.set(newest, "1970-01-01T00:00:01.000Z");
      yield* runner.run(profile.id);
      assert.equal(yield* Ref.get(calls), 2);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped),
);

it.effect("deduplicates context proposals by the reviewed run set instead of excerpts", () =>
  Effect.gen(function* () {
    const findings = yield* Ref.make<ReadonlyArray<MonitoringFinding>>([]);
    const excerpt = yield* Ref.make("Repeated");
    const secondRun = yield* Ref.make("context:second");
    const selected = { ...profile, kind: "context-review" as const };
    const layer = runnerLayer(
      selected,
      {
        list: () => Effect.succeed({ profiles: [selected], findings: [], runs: [] }),
        getFinding: (id) =>
          Ref.get(findings).pipe(Effect.map((all) => all.find((item) => item.id === id) ?? null)),
        saveFinding: (finding) => Ref.update(findings, (all) => [...all, finding]),
      },
      {
        capture: () =>
          Effect.all([Ref.get(secondRun), Ref.get(excerpt)]).pipe(
            Effect.map(([other, quoted]) => ({
              threads: [
                {
                  id: ThreadId.make("thread"),
                  title: "Main",
                  parentThreadId: null,
                  messages: (quoted === "Repeated"
                    ? ["context:run", other]
                    : [other, "context:run", "context:run"]
                  ).map((id) => ({ id, role: "context record", text: "Repeated reads" })),
                },
              ],
              truncated: false,
              coverage: "Context records",
            })),
          ),
      },
      () =>
        Ref.get(excerpt).pipe(
          Effect.map((excerpt) => ({
            findings: [
              {
                threadId: ThreadId.make("thread"),
                ruleId: "verify",
                summary: "Repeated reads",
                detail: "Use a summary",
                confidence: 0.7,
                evidence: [
                  {
                    threadId: ThreadId.make("thread"),
                    messageId: MessageId.make("context:run"),
                    excerpt,
                  },
                ],
              },
            ],
          })),
        ),
    );
    yield* Effect.gen(function* () {
      const runner = yield* Runner.MonitoringRunner;
      yield* runner.run(profile.id);
      yield* Ref.set(excerpt, "reads");
      yield* runner.run(profile.id);
      assert.equal((yield* Ref.get(findings)).length, 1);
      yield* Ref.set(secondRun, "context:third");
      yield* runner.run(profile.id);
      assert.equal((yield* Ref.get(findings)).length, 2);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped),
);

it.effect("records reported model cost when a review fails", () =>
  Effect.gen(function* () {
    const layer = runnerLayer(
      profile,
      {},
      {
        capture: () =>
          Effect.succeed({
            threads: [
              {
                id: ThreadId.make("thread"),
                title: "Main",
                parentThreadId: null,
                messages: [{ id: "message", role: "assistant", text: "Observed" }],
              },
            ],
            truncated: false,
            coverage: "Chat",
          }),
      },
      (input) =>
        Effect.sync(() => input.onCost?.(0.012)).pipe(
          Effect.andThen(
            Effect.fail(
              new TextGenerationError({
                operation: "generateMonitoringReview",
                detail: "Invalid output",
              }),
            ),
          ),
        ),
    );
    const run = yield* Effect.flatMap(Runner.MonitoringRunner, (runner) =>
      runner.run(profile.id),
    ).pipe(Effect.provide(layer));
    assert.equal(run.status, "failed");
    assert.equal(run.costUsd, 0.012);
  }).pipe(Effect.scoped),
);

function runnerLayer(
  selected: MonitoringProfile,
  store: Partial<Store.MonitoringStore["Service"]>,
  snapshot: Snapshot.MonitoringSnapshot["Service"],
  generate: NonNullable<
    import("@t3tools/provider-core/server/textGeneration").ProviderTextGeneration["generateMonitoringReview"]
  >,
  deliver: Delivery.MonitoringDelivery["Service"]["deliver"] = () =>
    Effect.succeed({ delivery: "workspace", messageId: null }),
) {
  return Runner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Store.MonitoringStore)({
          getProfile: () => Effect.succeed(selected),
          saveRun: () => Effect.void,
          ...store,
        }),
        Layer.succeed(Snapshot.MonitoringSnapshot, snapshot),
        Layer.mock(Delivery.MonitoringDelivery)({ deliver }),
        Layer.mock(Registry.ProviderInstanceRegistry)({
          getInstance: () =>
            Effect.succeed({
              enabled: true,
              driverKind: "claudeAgent",
              textGeneration: { generateMonitoringReview: generate },
              snapshot: {
                getSnapshot: Effect.succeed({
                  installed: true,
                  enabled: true,
                  status: "ready",
                  auth: { status: "authenticated" },
                  models: [{ slug: "haiku" }],
                }),
              },
            } as never),
        }),
        ServerConfig.layerTest("/workspace", { prefix: "t3-monitor-runner-" }),
      ),
    ),
    Layer.provide(Layer.merge(NodeCrypto.layer, NodeServices.layer)),
  );
}

it.effect(
  "retries retained context proposals even when no fresh context needs a model review",
  () =>
    Effect.gen(function* () {
      const proposals = yield* Ref.make<ReadonlyArray<MonitoringFinding>>([]);
      const attempts = yield* Ref.make(0);
      const runs = yield* Ref.make<ReadonlyArray<MonitoringRun>>([]);
      const selected = { ...profile, kind: "context-review" as const };
      const layer = runnerLayer(
        selected,
        {
          list: () =>
            Effect.all({
              profiles: Effect.succeed([selected]),
              findings: Ref.get(proposals),
              runs: Ref.get(runs),
            }),
          saveRun: (run) =>
            Ref.update(runs, (all) => [...all.filter((item) => item.id !== run.id), run]),
          getFinding: (id) =>
            Ref.get(proposals).pipe(
              Effect.map((all) => all.find((item) => item.id === id) ?? null),
            ),
          saveFinding: (finding) => Ref.update(proposals, (all) => [...all, finding]),
        },
        {
          capture: () =>
            Effect.succeed({
              newestContextAt: "1970-01-01T00:00:00.000Z",
              threads: [
                {
                  id: ThreadId.make("thread"),
                  title: "Main",
                  parentThreadId: null,
                  messages: [{ id: "context:run", role: "context record", text: "Repeated reads" }],
                },
              ],
              truncated: false,
              coverage: "Context records",
            }),
        },
        () =>
          Effect.succeed({
            findings: [
              {
                threadId: ThreadId.make("thread"),
                ruleId: "verify",
                summary: "Repeated reads",
                detail: "Use a summary",
                confidence: 0.7,
                evidence: [
                  {
                    threadId: ThreadId.make("thread"),
                    messageId: MessageId.make("context:run"),
                    excerpt: "Repeated",
                  },
                ],
              },
            ],
          }),
        () =>
          Ref.updateAndGet(attempts, (n) => n + 1).pipe(
            Effect.flatMap((n) =>
              n === 1
                ? Effect.fail(new MonitoringError({ operation: "propose context improvement" }))
                : Effect.succeed({ delivery: "workspace" as const, messageId: null }),
            ),
          ),
      );
      yield* Effect.gen(function* () {
        const runner = yield* Runner.MonitoringRunner;
        yield* runner.run(profile.id);
        assert.equal((yield* Ref.get(proposals)).length, 1);
        yield* runner.run(profile.id);
        assert.equal(yield* Ref.get(attempts), 2);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "deduplicates context proposals across profiles reviewing the same thread and run set",
  () =>
    Effect.gen(function* () {
      const first: MonitoringProfile = { ...profile, kind: "context-review" };
      const second: MonitoringProfile = {
        ...first,
        id: MonitoringProfileId.make("other-watcher"),
        scheduledTaskId: ScheduledTaskId.make("monitoring:other-watcher"),
      };
      const findings = yield* Ref.make<ReadonlyArray<MonitoringFinding>>([]);
      const deliveries = yield* Ref.make(0);
      const layer = runnerLayer(
        first,
        {
          getProfile: (id) => Effect.succeed(id === first.id ? first : second),
          list: () =>
            Ref.get(findings).pipe(
              Effect.map((findings) => ({ profiles: [first, second], findings, runs: [] })),
            ),
          getFinding: (id) =>
            Ref.get(findings).pipe(Effect.map((all) => all.find((item) => item.id === id) ?? null)),
          saveFinding: (finding) => Ref.update(findings, (all) => [...all, finding]),
        },
        {
          capture: () =>
            Effect.succeed({
              threads: [
                {
                  id: ThreadId.make("thread"),
                  title: "Main",
                  parentThreadId: null,
                  messages: [{ id: "context:run", role: "context record", text: "Repeated reads" }],
                },
              ],
              truncated: false,
              coverage: "Context records",
            }),
        },
        () =>
          Effect.succeed({
            findings: [
              {
                threadId: ThreadId.make("thread"),
                ruleId: "verify",
                summary: "Repeated reads",
                detail: "Use a summary",
                confidence: 0.7,
                evidence: [
                  {
                    threadId: ThreadId.make("thread"),
                    messageId: MessageId.make("context:run"),
                    excerpt: "Repeated",
                  },
                ],
              },
            ],
          }),
        () =>
          Ref.update(deliveries, (n) => n + 1).pipe(
            Effect.as({ delivery: "workspace" as const, messageId: null }),
          ),
      );
      yield* Effect.gen(function* () {
        const runner = yield* Runner.MonitoringRunner;
        yield* runner.run(first.id);
        yield* runner.run(second.id);
        assert.equal((yield* Ref.get(findings)).length, 1);
        assert.equal(yield* Ref.get(deliveries), 1);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "injects instruction files and project AGENTS, reports missing files, and caps injected bytes",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "monitor-instructions-" });
      const instructions = path.join(dir, "standards.md");
      const agents = path.join(dir, "AGENTS.md");
      const large = path.join(dir, "large.md");
      yield* fs.writeFileString(instructions, "Run focused tests before committing.");
      yield* fs.writeFileString(agents, "Comments explain why.");
      yield* fs.writeFileString(large, "大".repeat(40_000));
      let prompt = "";
      const snapshot: Snapshot.MonitoringSnapshotData = {
        projectRoot: dir,
        threads: [
          {
            id: ThreadId.make("thread"),
            title: "Main",
            parentThreadId: null,
            messages: [{ id: "message", role: "assistant", text: "Observed" }],
          },
        ],
        truncated: false,
        coverage: "Chat",
      };
      const selected = {
        ...profile,
        instructionFiles: [instructions, path.join(dir, "missing.md"), large],
        includeProjectAgents: true,
      };
      const layer = runnerLayer(
        selected,
        {},
        { capture: () => Effect.succeed(snapshot) },
        (input) => {
          prompt = input.prompt;
          return Effect.succeed({ findings: [] });
        },
      );
      yield* Effect.gen(function* () {
        const runner = yield* Runner.MonitoringRunner;
        yield* runner.review({
          ...selected,
          instructionFiles: selected.instructionFiles.slice(0, 2),
        });
        assert.include(prompt, "Run focused tests before committing.");
        assert.include(prompt, "Comments explain why.");
        assert.include(prompt, "Missing or unreadable instruction file");
        yield* runner.review(selected);
        const payload = JSON.parse(prompt.slice(prompt.indexOf('{"standards":'))) as {
          instructionFiles: string;
        };
        assert.isAtMost(Buffer.byteLength(payload.instructionFiles), 64 * 1024);
        assert.include(payload.instructionFiles, "Instruction sources truncated");
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
