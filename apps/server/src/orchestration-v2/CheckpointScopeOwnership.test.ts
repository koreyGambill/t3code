import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import {
  CheckpointId,
  type CheckpointScopeId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2Run,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as CheckpointCaptureService from "./CheckpointCaptureService.ts";
import * as CheckpointService from "./CheckpointService.ts";
import { checkpointRefForScopeOrdinal } from "./CheckpointService.ts";
import { isCheckpointRestoreIsolated } from "./CheckpointRestoreSafety.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import type * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
const layerProjection = Layer.mergeAll(
  ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
  SqlitePersistence.layerMemory,
  IdAllocator.layer,
  NodeCrypto.layer,
);
it.effect("resolves the thread baseline after a second root run replaces scope ownership", () =>
  Effect.gen(function* () {
    const ids = yield* IdAllocator.IdAllocatorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const now = DateTime.makeUnsafe("2026-09-08T12:00:00.000Z");
    const threadId = ThreadId.make("thread:audit-root-scope");
    const firstRunId = RunId.make("run:audit-root-scope:1");
    const secondRunId = RunId.make("run:audit-root-scope:2");
    const firstNodeId = NodeId.make("node:audit-root-scope:1");
    const secondNodeId = NodeId.make("node:audit-root-scope:2");
    const providerThreadId = ProviderThreadId.make("provider-thread:audit-root-scope");
    const providerInstanceId = ProviderInstanceId.make("codex");
    const scopeId = yield* ids.allocate.checkpointScope({ threadId, name: "root" });
    const checkpointRefs = [
      yield* checkpointRefForScopeOrdinal({ scopeId, ordinalWithinScope: 0 }),
      yield* checkpointRefForScopeOrdinal({ scopeId, ordinalWithinScope: 1 }),
      yield* checkpointRefForScopeOrdinal({ scopeId, ordinalWithinScope: 2 }),
    ];
    const baselineId = CheckpointId.make("checkpoint:audit-root-scope:0");
    const firstCheckpointId = CheckpointId.make("checkpoint:audit-root-scope:1");
    const secondCheckpointId = CheckpointId.make("checkpoint:audit-root-scope:2");
    const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.4" } as const;

    yield* projections.apply({
      id: EventId.make("event:audit-root-scope:thread"),
      type: "thread.created",
      threadId,
      providerInstanceId,
      occurredAt: now,
      payload: {
        createdBy: "user",
        creationSource: "web",
        id: threadId,
        projectId: ProjectId.make("project:audit-root-scope"),
        title: "Checkpoint scope probe",
        providerInstanceId,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThreadId,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
    });

    const applyRun = (input: {
      readonly runId: RunId;
      readonly nodeId: NodeId;
      readonly ordinal: number;
      readonly checkpointId: CheckpointId;
    }) =>
      projections.apply({
        id: EventId.make(`event:audit-root-scope:run:${input.ordinal}`),
        type: "run.updated",
        threadId,
        runId: input.runId,
        nodeId: input.nodeId,
        providerInstanceId,
        occurredAt: now,
        payload: {
          id: input.runId,
          threadId,
          ordinal: input.ordinal,
          providerInstanceId,
          modelSelection,
          providerThreadId,
          userMessageId: MessageId.make(`message:audit-root-scope:${input.ordinal}`),
          rootNodeId: input.nodeId,
          activeAttemptId: null,
          status: "completed" as const,
          requestedAt: now,
          startedAt: now,
          completedAt: now,
          checkpointId: input.checkpointId,
          contextHandoffId: null,
        },
      });
    const applyScope = (runId: RunId, nodeId: NodeId, ordinal: number) =>
      projections.apply({
        id: EventId.make(`event:audit-root-scope:scope:${ordinal}`),
        type: "checkpoint-scope.created",
        threadId,
        runId,
        nodeId,
        providerInstanceId,
        occurredAt: now,
        payload: {
          id: scopeId,
          threadId,
          runId,
          nodeId,
          parentScopeId: null,
          providerThreadId,
          kind: "root_run" as const,
          ordinalWithinParent: 0,
          advancesAppRunCount: true,
          cwd: ordinal === 1 ? "/repo" : "/prepared-repo",
          createdAt: now,
        },
      });
    const applyCheckpoint = (input: {
      readonly id: CheckpointId;
      readonly runId: RunId | null;
      readonly nodeId: NodeId;
      readonly ordinal: number;
      readonly appRunOrdinal: number | null;
    }) =>
      projections.apply({
        id: EventId.make(`event:audit-root-scope:checkpoint:${input.ordinal}`),
        type: "checkpoint.captured",
        threadId,
        ...(input.runId === null ? {} : { runId: input.runId }),
        nodeId: input.nodeId,
        providerInstanceId,
        occurredAt: now,
        payload: {
          id: input.id,
          scopeId,
          threadId,
          runId: input.runId,
          nodeId: input.nodeId,
          parentCheckpointId:
            input.ordinal === 0 ? null : input.ordinal === 1 ? baselineId : firstCheckpointId,
          ordinalWithinScope: input.ordinal,
          appRunOrdinal: input.appRunOrdinal,
          ref: checkpointRefs[input.ordinal]!,
          status: "ready" as const,
          files: [],
          capturedAt: now,
        },
      });

    yield* applyRun({
      runId: firstRunId,
      nodeId: firstNodeId,
      ordinal: 1,
      checkpointId: firstCheckpointId,
    });
    yield* applyScope(firstRunId, firstNodeId, 1);
    yield* applyCheckpoint({
      id: baselineId,
      runId: null,
      nodeId: firstNodeId,
      ordinal: 0,
      appRunOrdinal: null,
    });
    yield* applyCheckpoint({
      id: firstCheckpointId,
      runId: firstRunId,
      nodeId: firstNodeId,
      ordinal: 1,
      appRunOrdinal: 1,
    });
    yield* applyRun({
      runId: secondRunId,
      nodeId: secondNodeId,
      ordinal: 2,
      checkpointId: secondCheckpointId,
    });
    yield* applyScope(secondRunId, secondNodeId, 2);
    yield* applyCheckpoint({
      id: secondCheckpointId,
      runId: secondRunId,
      nodeId: secondNodeId,
      ordinal: 2,
      appRunOrdinal: 2,
    });

    const context = yield* projections.getCheckpointContext(threadId);
    assert.deepEqual(
      context.checkpoints.map((checkpoint) => checkpoint.appRunOrdinal),
      [null, 1, 2],
    );
    assert.equal(context.checkpointScopes.length, 1);
    assert.equal(context.checkpointScopes[0]?.runId, secondRunId);

    const layerQuery = CheckpointDiffQuery.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getCheckpointContext: () => Effect.succeed(context),
          }),
          Layer.mock(CheckpointStore.CheckpointStore)({
            listAuthoredPaths: () => Effect.succeed(null),
            diffCheckpoints: (input) => {
              assert.equal(input.cwd, "/prepared-repo");
              assert.equal(input.fromCheckpointRef, checkpointRefs[0]);
              assert.equal(input.toCheckpointRef, checkpointRefs[2]);
              return Effect.succeed("two-run diff");
            },
          }),
        ),
      ),
    );
    const result = yield* Effect.gen(function* () {
      const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
      return yield* query.getFullThreadDiff({ threadId, toTurnCount: 2 });
    }).pipe(Effect.provide(layerQuery));
    assert.equal(result.diff, "two-run diff");
  }).pipe(Effect.provide(layerProjection)),
);

const checkoutPeriodsLayer = (store: {
  readonly captured: Set<string>;
  readonly diffs: Array<{ cwd: string; from: string; to: string }>;
}) => {
  const checkpointStore = Layer.mock(CheckpointStore.CheckpointStore)({
    isGitRepository: () => Effect.succeed(true),
    hasCheckpointRef: ({ cwd, checkpointRef }) =>
      Effect.sync(() => store.captured.has(`${cwd} ${checkpointRef}`)),
    captureCheckpoint: ({ cwd, checkpointRef }) =>
      Effect.sync(() => void store.captured.add(`${cwd} ${checkpointRef}`)),
    listAuthoredPaths: () => Effect.succeed(null),
    diffCheckpoints: (input) =>
      Effect.sync(() => {
        store.diffs.push({
          cwd: input.cwd,
          from: input.fromCheckpointRef,
          to: input.toCheckpointRef,
        });
        return "diff";
      }),
  });
  const checkpoints = CheckpointService.layer.pipe(
    Layer.provide(checkpointStore),
    Layer.provideMerge(layerProjection),
    Layer.provideMerge(NodeServices.layer),
  );
  return Layer.mergeAll(
    CheckpointCaptureService.layer.pipe(
      Layer.provide(
        Layer.effect(
          EventSink.EventSinkV2,
          Effect.map(ProjectionStore.ProjectionStoreV2, (projections) =>
            EventSink.EventSinkV2.of({
              commitCommand: (input: Parameters<EventSink.EventSinkV2Shape["commitCommand"]>[0]) =>
                Effect.forEach(input.events, (event) => projections.apply(event)).pipe(
                  Effect.as({ committed: true } as never),
                  Effect.orDie,
                ),
            } as never),
          ),
        ),
      ),
      Layer.provideMerge(checkpoints),
    ),
    CheckpointDiffQuery.layer.pipe(
      Layer.provide(
        Layer.effect(
          ThreadManagement.ThreadManagementService,
          Effect.map(ProjectionStore.ProjectionStoreV2, (projections) =>
            ThreadManagement.ThreadManagementService.of({
              getCheckpointContext: (threadId: ThreadId) =>
                projections.getCheckpointContext(threadId),
            } as never),
          ),
        ),
      ),
      Layer.provide(checkpointStore),
      Layer.provide(checkpoints),
    ),
  );
};

const makeCheckoutPeriodThread = Effect.fn("test.makeCheckoutPeriodThread")(function* (
  name: string,
) {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const checkpoints = yield* CheckpointService.CheckpointServiceV2;
  const capture = yield* CheckpointCaptureService.CheckpointCaptureServiceV2;
  const now = DateTime.makeUnsafe("2026-11-07T12:00:00.000Z");
  const threadId = ThreadId.make(`thread:checkout-periods:${name}`);
  const providerThreadId = ProviderThreadId.make(`provider-thread:checkout-periods:${name}`);
  const providerInstanceId = ProviderInstanceId.make("codex");
  const driver = ProviderDriverKind.make("codex");
  const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.4" } as const;
  yield* projections.apply({
    id: EventId.make(`event:checkout-periods:${name}:thread`),
    type: "thread.created",
    threadId,
    providerInstanceId,
    occurredAt: now,
    payload: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make("project:checkout-periods"),
      title: "Checkout periods",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThreadId,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  yield* projections.apply({
    id: EventId.make(`event:checkout-periods:${name}:provider-thread`),
    type: "provider-thread.updated",
    threadId,
    driver,
    providerInstanceId,
    occurredAt: now,
    payload: {
      id: providerThreadId,
      driver,
      providerInstanceId,
      providerSessionId: null,
      appThreadId: threadId,
      ownerNodeId: null,
      nativeThreadRef: null,
      nativeConversationHeadRef: null,
      status: "idle",
      firstRunOrdinal: 1,
      lastRunOrdinal: 1,
      handoffIds: [],
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  const run = (ordinal: number) => ({
    id: RunId.make(`run:checkout-periods:${name}:${ordinal}`),
    threadId,
    ordinal,
    providerInstanceId,
    modelSelection,
    providerThreadId,
    userMessageId: MessageId.make(`message:checkout-periods:${name}:${ordinal}`),
    rootNodeId: null,
    activeAttemptId: null,
    status: "queued" as const,
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    checkpointId: null,
    contextHandoffId: null,
  });
  const writeRun = (ordinal: number, payload: OrchestrationV2Run, step: string) =>
    projections.apply({
      id: EventId.make(`event:checkout-periods:${name}:${ordinal}:run-${step}`),
      type: "run.updated",
      threadId,
      runId: payload.id,
      providerInstanceId,
      occurredAt: now,
      payload,
    });

  /** Prepares, baselines, and captures one run as turn start and completion do. */
  const complete = Effect.fn("test.completeRunInCheckout")(function* (
    ordinal: number,
    cwd: string,
  ) {
    const nodeId = NodeId.make(`node:checkout-periods:${name}:${ordinal}`);
    const scope = yield* checkpoints.prepareRootRunScope({
      threadId,
      runId: run(ordinal).id,
      runOrdinal: ordinal,
      rootNodeId: nodeId,
      providerThreadId,
      cwd,
      createdAt: now,
    });
    yield* projections.apply({
      id: EventId.make(`event:checkout-periods:${name}:${ordinal}:scope`),
      type: "checkpoint-scope.created",
      threadId,
      runId: run(ordinal).id,
      nodeId,
      providerInstanceId,
      occurredAt: now,
      payload: scope,
    });
    yield* projections.apply({
      id: EventId.make(`event:checkout-periods:${name}:${ordinal}:node`),
      type: "node.updated",
      threadId,
      runId: run(ordinal).id,
      nodeId,
      providerInstanceId,
      occurredAt: now,
      payload: {
        id: nodeId,
        threadId,
        runId: run(ordinal).id,
        parentNodeId: null,
        rootNodeId: nodeId,
        kind: "root_turn",
        status: "waiting",
        countsForRun: true,
        providerThreadId,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId: scope.id,
        startedAt: now,
        completedAt: null,
      },
    });
    yield* writeRun(
      ordinal,
      { ...run(ordinal), rootNodeId: nodeId, status: "waiting", startedAt: now },
      "waiting",
    );
    yield* checkpoints.captureBaseline({ scope, ordinalWithinScope: ordinal - 1 });
    yield* capture.execute({ threadId, runId: run(ordinal).id, scopeId: scope.id });
    return scope;
  });
  const cancelQueued = (ordinal: number) =>
    writeRun(ordinal, { ...run(ordinal), status: "cancelled", completedAt: now }, "cancelled");
  const rollBack = Effect.fn("test.rollBackRun")(function* (ordinal: number) {
    const { runs } = yield* projections.getThreadRecords(threadId, ["runs"]);
    const target = runs.find((candidate) => candidate.ordinal === ordinal)!;
    yield* writeRun(ordinal, { ...target, status: "rolled_back" }, "rolled-back");
  });
  return { threadId, complete, cancelQueued, rollBack };
});

it.effect(
  "starts a root scope per checkout period from the run's own baseline and diffs captured refs",
  () => {
    const store = {
      captured: new Set<string>(),
      diffs: [] as Array<{ cwd: string; from: string; to: string }>,
    };
    return Effect.gen(function* () {
      const ids = yield* IdAllocator.IdAllocatorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
      const ref = (scopeId: CheckpointScopeId, ordinalWithinScope: number) =>
        checkpointRefForScopeOrdinal({ scopeId, ordinalWithinScope });
      const assertDiffsUseCapturedRefs = () => {
        for (const diff of store.diffs.splice(0)) {
          assert.isTrue(store.captured.has(`${diff.cwd} ${diff.from}`), `from ${diff.from}`);
          assert.isTrue(store.captured.has(`${diff.cwd} ${diff.to}`), `to ${diff.to}`);
        }
      };

      const returning = yield* makeCheckoutPeriodThread("returning");
      const first = yield* returning.complete(1, "/checkout-a");
      const second = yield* returning.complete(2, "/checkout-b");
      const third = yield* returning.complete(3, "/checkout-b");
      const fourth = yield* returning.complete(4, "/checkout-a");
      assert.equal(
        first.id,
        yield* ids.allocate.checkpointScope({ threadId: returning.threadId, name: "root" }),
      );
      assert.equal(first.baselineOrdinalWithinScope, undefined);
      assert.notEqual(second.id, first.id);
      assert.equal(second.baselineOrdinalWithinScope, 1);
      assert.equal(third.id, second.id);
      assert.equal(third.baselineOrdinalWithinScope, 1);
      assert.notEqual(fourth.id, first.id);
      assert.notEqual(fourth.id, second.id);
      assert.equal(fourth.baselineOrdinalWithinScope, 3);

      const context = yield* projections.getCheckpointContext(returning.threadId);
      assert.deepEqual(
        context.checkpointScopes.map((scope) => [scope.id, scope.cwd]).sort(),
        [
          [first.id, "/checkout-a"],
          [second.id, "/checkout-b"],
          [fourth.id, "/checkout-a"],
        ].sort(),
      );
      const restoreDependencies = {
        fileSystem: yield* FileSystem.FileSystem,
        path: yield* Path.Path,
        projections,
        projects: {} as ProjectStore.ProjectStoreV2["Service"],
      };
      const threadInA = { id: returning.threadId, worktreePath: "/checkout-a" };
      assert.isTrue(yield* isCheckpointRestoreIsolated(threadInA, first, restoreDependencies));
      assert.isFalse(yield* isCheckpointRestoreIsolated(threadInA, second, restoreDependencies));

      assertDiffsUseCapturedRefs();
      yield* query.getFullThreadDiff({ threadId: returning.threadId, toTurnCount: 3 });
      const clamped = yield* query.getTurnDiff({
        threadId: returning.threadId,
        fromTurnCount: 1,
        toTurnCount: 4,
      });
      assert.equal(clamped.fromTurnCount, 3);
      assert.equal(clamped.toTurnCount, 4);
      yield* query.getTurnDiff({ threadId: returning.threadId, fromTurnCount: 3, toTurnCount: 4 });
      assert.deepEqual(store.diffs, [
        { cwd: "/checkout-b", from: yield* ref(second.id, 1), to: yield* ref(second.id, 3) },
        { cwd: "/checkout-a", from: yield* ref(fourth.id, 3), to: yield* ref(fourth.id, 4) },
        { cwd: "/checkout-a", from: yield* ref(fourth.id, 3), to: yield* ref(fourth.id, 4) },
      ]);
      assertDiffsUseCapturedRefs();

      for (const [label, returnTo] of [
        ["cancelled-a", "/checkout-a"],
        ["cancelled-b", "/checkout-b"],
      ] as const) {
        const thread = yield* makeCheckoutPeriodThread(label);
        const inA = yield* thread.complete(1, "/checkout-a");
        const inB = yield* thread.complete(2, "/checkout-b");
        yield* thread.cancelQueued(3);
        const after = yield* thread.complete(4, returnTo);
        if (returnTo === "/checkout-b") {
          assert.equal(after.id, inB.id);
          assert.equal(after.baselineOrdinalWithinScope, 1);
        } else {
          assert.notEqual(after.id, inA.id);
          assert.notEqual(after.id, inB.id);
          assert.equal(after.baselineOrdinalWithinScope, 3);
        }
        yield* query.getFullThreadDiff({ threadId: thread.threadId, toTurnCount: 4 });
        assertDiffsUseCapturedRefs();
      }

      const rewound = yield* makeCheckoutPeriodThread("rewound");
      yield* rewound.complete(1, "/checkout-a");
      yield* rewound.complete(2, "/checkout-b");
      yield* rewound.rollBack(2);
      const afterRollback = yield* rewound.complete(3, "/checkout-c");
      assert.equal(afterRollback.baselineOrdinalWithinScope, 2);
      const rewoundDiff = yield* query.getFullThreadDiff({
        threadId: rewound.threadId,
        toTurnCount: 3,
      });
      assert.equal(rewoundDiff.fromTurnCount, 2);
      assertDiffsUseCapturedRefs();
    }).pipe(Effect.provide(checkoutPeriodsLayer(store)));
  },
);
