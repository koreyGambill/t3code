import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CommandId,
  EventId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  XwingEnvironmentId,
  XwingEnvironmentNotFoundError,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ServerEnvironmentIdentity } from "../environment/ServerEnvironment.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import { ProviderSessionManagerV2 } from "../orchestration-v2/ProviderSessionManager.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as XwingEnvironments from "../xwing/XwingEnvironments.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import * as XwingOperations from "../xwing/XwingOperations.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Holds from "./DevelopmentEnvironmentHolds.ts";
import * as Lifecycle from "./DevelopmentEnvironmentLifecycle.ts";

it.effect.each([
  "message during release",
  "message while lease busy",
  "queued rollback",
  "legacy project root",
  "interrupted hold release",
])("refuses deletion with %s", (actor) =>
  Effect.gen(function* () {
    const id = XwingEnvironmentId.make("c838284042dc51de");
    const root = "/home/dev/.xwing/envs/7";
    const threadId = ThreadId.make("cleanup-admission");
    const serverId = EnvironmentId.make("cleanup-admission-server");
    const owner = Holds.holdOwner(serverId);
    const key = Holds.holdKey({ threadId, period: "original-binding" });
    const released = yield* Deferred.make<void>();
    const resumeDelete = yield* Deferred.make<void>();
    let held = true;
    let deleted = false;
    const operations = Layer.mock(XwingOperations.XwingOperations)({
      previewCleanup: () =>
        Effect.sync(() => ({
          environmentId: id,
          number: 7,
          name: "cleanup-admission",
          status: "ready",
          rootPath: root,
          worktrees: [
            { name: "app", path: `${root}/app`, dirty: false, untracked: false, ignored: false },
          ],
          holds: held
            ? [
                {
                  environmentId: id,
                  owner,
                  key,
                  label: "thread",
                  createdAt: "now",
                  updatedAt: "now",
                },
              ]
            : [],
          blockers: held
            ? [`held by ${owner} ${key} ("thread"); release with xwing env hold release`]
            : [],
          retainedPaths: [],
          deletable: !held,
        })),
      releaseHold: () =>
        Effect.gen(function* () {
          held = false;
          yield* Deferred.succeed(released, undefined);
          yield* Deferred.await(resumeDelete);
          return {
            environmentId: id,
            owner,
            key,
            environmentStatus: "active" as const,
            result: "released" as const,
          };
        }),
      registerHold: () =>
        Effect.sync(() => {
          held = true;
          return {
            hold: {
              environmentId: id,
              owner,
              key,
              label: "thread",
              createdAt: "now",
              updatedAt: "now",
              environmentStatus: "active" as const,
            },
            result: "created" as const,
          };
        }),
      delete: () =>
        Effect.sync(() => {
          deleted = true;
          return {
            environmentId: id,
            outcome: "deleted" as const,
            removedWorktrees: [`${root}/app`],
            retainedPaths: [],
            stoppedApplications: [],
          };
        }),
    });
    const instanceId = ProviderInstanceId.make("codex");
    const modelSelection = { instanceId, model: "gpt-5.1-codex" };
    const adapter = {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
      planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
      openSession: () => Effect.die("No provider process needed for admission"),
    } as ProviderAdapter.ProviderAdapterV2["Service"];
    const database = SqlitePersistence.layerMemory;
    const runtime = Layer.mergeAll(
      ProjectionStore.layer.pipe(Layer.provide(database)),
      ProjectStore.layer.pipe(Layer.provide(database)),
      EffectOutbox.layer.pipe(Layer.provide(database)),
      ProviderReplayHarness.layerWithRegistry(
        { name: "cleanup-admission" },
        ProviderAdapterRegistry.layerFromAdapters([adapter]),
        { databaseLayer: database, runEffectWorker: false },
      ),
    );
    const identity = Layer.mock(ServerEnvironmentIdentity)({
      getEnvironmentId: Effect.succeed(serverId),
    });
    const dependencies = Layer.mergeAll(
      operations,
      identity,
      NodeServices.layer,
      Layer.mock(ProviderSessionManagerV2)({}),
      Layer.mock(TerminalManager.TerminalManager)({
        hasForegroundWork: () => Effect.succeed(false),
      }),
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({
        list: () => Effect.succeed({ tasks: [] }),
      }),
      Layer.mock(ProjectService.ProjectService)({
        getById: () => Effect.succeed(Option.some({ workspaceRoot: `${root}/app` }) as never),
      }),
      Layer.mock(GitVcsDriver.GitVcsDriver)({}),
      Layer.mock(XwingEnvironments.XwingEnvironments)({
        inspect: () => Effect.fail(new XwingEnvironmentNotFoundError({ environmentId: id })),
      }),
    );
    const layer = Lifecycle.layer.pipe(
      Layer.provide(Holds.layer.pipe(Layer.provide(dependencies))),
      Layer.provide(dependencies),
      Layer.provideMerge(runtime),
    );
    yield* Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const lifecycle = yield* Lifecycle.DevelopmentEnvironmentLifecycle;
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cleanup-admission-create"),
        threadId,
        projectId: ProjectId.make("cleanup-admission-project"),
        title: "Cleanup admission",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: actor === "legacy project root" ? null : `${root}/app`,
        developmentEnvironment:
          actor === "legacy project root"
            ? undefined
            : {
                xwingEnvironmentId: id,
                repositorySource: "/home/dev/src/app",
                checkoutPath: `${root}/app`,
                number: 7,
                name: "cleanup-admission",
              },
        createdBy: "user",
        creationSource: "web",
      });
      if (actor === "legacy project root") {
        const projectId = ProjectId.make("cleanup-admission-project");
        const projects = yield* ProjectStore.ProjectStoreV2;
        yield* projects.apply({
          sequence: 1,
          eventId: EventId.make("legacy-project-create"),
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: "2026-11-07T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId,
            title: "Legacy project",
            workspaceRoot: `${root}/app`,
            defaultModelSelection: modelSelection,
            scripts: [],
            createdAt: "2026-11-07T00:00:00.000Z",
            updatedAt: "2026-11-07T00:00:00.000Z",
          },
        });
        const assessment = yield* lifecycle.assessCleanup({ xwingEnvironmentId: id });
        assert.deepEqual(
          assessment.threads.map((thread) => [thread.threadId, thread.current, thread.block]),
          [[threadId, true, "unsettled"]],
        );
        assert.isFalse(assessment.canClean);
        return;
      }
      if (actor === "queued rollback") {
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          origin: { kind: "user" as const },
          commandId: CommandId.make("rollback-seed-run"),
          threadId,
          messageId: MessageId.make("rollback-seed-run"),
          text: "Prepare checkpoint scope",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        const seeded = yield* projections.getThreadProjection(threadId);
        const providerThread = seeded.providerThreads[0]!;
        const scope = seeded.checkpointScopes[0]!;
        const now = yield* DateTime.now;
        yield* projections.apply({
          id: EventId.make("rollback-seed-session"),
          type: "provider-thread.updated",
          threadId,
          occurredAt: now,
          payload: {
            ...providerThread,
            providerSessionId: ProviderSessionId.make("rollback-session"),
          },
        });
        const checkpointId = CheckpointId.make("rollback-target");
        yield* projections.apply({
          id: EventId.make("rollback-seed-checkpoint"),
          type: "checkpoint.captured",
          threadId,
          occurredAt: now,
          payload: {
            id: checkpointId,
            threadId,
            scopeId: scope.id,
            runId: null,
            nodeId: scope.nodeId,
            parentCheckpointId: null,
            ordinalWithinScope: 0,
            appRunOrdinal: null,
            ref: CheckpointRef.make("refs/t3/rollback-target"),
            status: "ready",
            files: [],
            capturedAt: now,
          },
        });
        yield* orchestrator.dispatch({
          type: "run.interrupt",
          commandId: CommandId.make("rollback-seed-stop"),
          threadId,
          runId: seeded.runs[0]!.id,
        });
        yield* orchestrator.dispatch({
          type: "thread.settle",
          commandId: CommandId.make("rollback-seed-settle"),
          threadId,
        });
        const rollbackCommand = CommandId.make("rollback-queued");
        yield* orchestrator.dispatch({
          type: "checkpoint.rollback",
          commandId: rollbackCommand,
          threadId,
          checkpointId,
          scopeId: scope.id,
          restoreFiles: false,
        });
        const pending = yield* (yield* EffectOutbox.EffectOutboxV2).listByCommandId(
          rollbackCommand,
        );
        assert.deepEqual(
          pending.map((row) => [row.request.type, row.status]),
          [["provider-thread.rollback", "pending"]],
        );
        const assessment = yield* lifecycle.assessCleanup({ xwingEnvironmentId: id });
        yield* Deferred.succeed(resumeDelete, undefined);
        yield* lifecycle
          .cleanUp({
            xwingEnvironmentId: id,
            fingerprint: assessment.fingerprint,
            action: "delete",
          })
          .pipe(Effect.result);
        assert.isFalse(deleted);
        assert.isFalse(assessment.canClean);
        return;
      }
      yield* orchestrator.dispatch({
        type: "thread.settle",
        commandId: CommandId.make("cleanup-admission-settle"),
        threadId,
      });
      const assessment = yield* lifecycle.assessCleanup({ xwingEnvironmentId: id });
      assert.isTrue(assessment.canClean);
      const leaseEntered = yield* Deferred.make<void>();
      const releaseLease = yield* Deferred.make<void>();
      const leaseHolder =
        actor === "message while lease busy"
          ? yield* withWorkspaceLease(
              `${root}/app`,
              Deferred.succeed(leaseEntered, undefined).pipe(
                Effect.andThen(Deferred.await(releaseLease)),
              ),
            ).pipe(Effect.forkChild)
          : undefined;
      if (leaseHolder !== undefined) {
        yield* Deferred.await(leaseEntered);
        yield* Deferred.succeed(resumeDelete, undefined);
      }
      const cleaning = yield* lifecycle
        .cleanUp({ xwingEnvironmentId: id, fingerprint: assessment.fingerprint, action: "delete" })
        .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
      if (leaseHolder === undefined) yield* Deferred.await(released);
      if (actor === "interrupted hold release") {
        yield* Fiber.interrupt(cleaning);
        assert.isFalse(deleted);
        assert.isTrue(held);
        return;
      }
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        origin: { kind: "user" as const },
        commandId: CommandId.make("cleanup-admission-message"),
        threadId,
        messageId: MessageId.make("cleanup-admission-message"),
        text: "Do more work",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      const active = yield* projections.getThreadProjection(threadId);
      assert.isTrue(Orchestrator.threadHasUnfinishedWork(active));
      yield* Deferred.succeed(resumeDelete, undefined);
      if (leaseHolder !== undefined) {
        yield* Deferred.succeed(releaseLease, undefined);
        yield* Fiber.join(leaseHolder);
      }
      yield* Fiber.join(cleaning);
      assert.isFalse(deleted);
    }).pipe(Effect.provide(layer));
  }),
);
