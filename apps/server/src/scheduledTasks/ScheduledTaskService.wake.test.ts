import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const input = {
  commandId: "wake-test",
  title: "Resume work",
  prompt: "Continue the authorized work.",
  enabled: true,
  projectId: "project:test",
  threadId: "thread:main",
  threadMode: "continue",
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: "codex", model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
};
const decode = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);
const fixture = Effect.gen(function* () {
  const tick = yield* Ref.make<Effect.Effect<void>>(Effect.void);
  const sends = yield* Ref.make<ThreadManagementService.ThreadManagementSendInput[]>([]);
  const landed = yield* Ref.make(false);
  const scheduler: Scheduler.Scheduler["Service"] = {
    register: <E, R>(name: string, run: Effect.Effect<void, E, R>) =>
      Effect.gen(function* () {
        const context = yield* Effect.context<R>();
        if (name === "scheduled-tasks")
          yield* Ref.set(tick, run.pipe(Effect.provideContext(context), Effect.orDie));
      }),
  };
  const dependencies = Layer.mergeAll(
    NodeCrypto.layer,
    ManagedPolicy.layerTest(),
    Layer.succeed(Scheduler.Scheduler, scheduler),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      sendToThread: (message) =>
        Ref.update(sends, (all) => [...all, message]).pipe(Effect.as({} as never)),
    }),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      isScratchProject: () => Effect.succeed(false),
    }),
    Layer.mock(SecretRequests.SecretRequests)({}),
    Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (request) =>
        Ref.get(landed).pipe(
          Effect.map((isLanded) => ({
            exitCode: ChildProcessSpawner.ExitCode(
              request.args[0] === "rev-parse" || isLanded ? 0 : 1,
            ),
            stdout: "0123456789abcdef0123456789abcdef01234567\n",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          })),
        ),
    }),
  );
  return {
    tick: Ref.get(tick).pipe(Effect.flatten),
    sends,
    landed,
    layer: ScheduledTaskService.layer.pipe(Layer.provide(dependencies)),
  };
});

it.effect.each([
  { type: "thread_finished", threadId: "thread:child" },
  { type: "task_finished", task: "step 3" },
  { type: "git_landed", repoPath: "/repo", ref: "feature" },
] as const)("wakes once for $type, persists across restart, and can be cancelled", (wakeWhen) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const sql = yield* SqlClient.SqlClient;
    const created = yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const created = yield* service.upsert(
        yield* decode({ ...input, schedule: { type: "interval", everyMs: 60_000, wakeWhen } }),
      );
      yield* TestClock.adjust("1 minute");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(0);
      return created;
    }).pipe(Effect.provide(f.layer));
    if (wakeWhen.type === "thread_finished") {
      yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
      VALUES ('child-run', 'thread:child', 1, 'codex', 'completed', '2026-01-01T00:00:00Z', '{}')`;
    } else if (wakeWhen.type === "task_finished") {
      yield* sql`INSERT INTO orchestration_v2_projection_subagents (subagent_id, thread_id, parent_node_id, provider, origin, status, updated_at, payload_json)
      VALUES ('task-3', 'thread:main', 'root', 'codex', 'app_owned', 'completed', '2026-01-01T00:00:00Z', '{"title":"step 3"}')`;
    } else yield* Ref.set(f.landed, true);
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* service.setEnabled({ id: created.task.id, enabled: false });
      yield* TestClock.adjust("1 minute");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(0);
      yield* service.setEnabled({ id: created.task.id, enabled: true });
      yield* TestClock.adjust("1 minute");
      yield* f.tick;
      const sent = yield* Ref.get(f.sends);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toContain("Wake condition fired:");
      expect((yield* service.list()).tasks[0]?.enabled).toBe(false);
      yield* TestClock.adjust("2 minutes");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect.each([false, true])("check-ins skip unchanged state unless alwaysRun=%s", (alwaysRun) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert(
        yield* decode({
          ...input,
          schedule: { type: "interval", everyMs: 60_000, checkin: true, alwaysRun },
        }),
      );
      yield* TestClock.adjust("1 minute");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(1);
      yield* TestClock.adjust("1 minute");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(alwaysRun ? 2 : 1);
      expect((yield* service.list()).tasks[0]?.lastRunStatus).toBe(
        alwaysRun ? "succeeded" : "skipped",
      );
      // Changing a wake condition is new work, even when no child changed.
      yield* service.upsert(
        yield* decode({
          ...input,
          commandId: "other-wake",
          schedule: {
            type: "interval",
            everyMs: 60_000,
            wakeWhen: { type: "thread_finished", threadId: "other" },
          },
        }),
      );
      yield* TestClock.adjust("1 minute");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(alwaysRun ? 3 : 2);
      yield* service.delete({ id: task.id });
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("idle check-ins retain their baseline across restart and detect queue changes", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const sql = yield* SqlClient.SqlClient;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* service.upsert(
        yield* decode({
          ...input,
          schedule: { type: "interval", everyMs: 1_800_000, idleCheckin: true },
        }),
      );
      yield* TestClock.adjust("30 minutes");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* TestClock.adjust("30 minutes");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(1);
      expect((yield* service.list()).tasks[0]?.lastRunStatus).toBe("skipped");
      yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
      VALUES ('queued', 'thread:main', 1, 'codex', 'queued', '2026-01-01T00:00:00Z', '{}')`;
      yield* TestClock.adjust("30 minutes");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(2);
      yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'cancelled' WHERE run_id = 'queued'`;
      yield* TestClock.adjust("30 minutes");
      yield* f.tick;
      expect(yield* Ref.get(f.sends)).toHaveLength(3);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
