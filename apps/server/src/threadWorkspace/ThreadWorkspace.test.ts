// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import { expect, it } from "@effect/vitest";
import { EventId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import {
  emptyProjection,
  ProjectionStoreThreadNotFoundError,
} from "../orchestration-v2/ProjectionStore.ts";
import * as Workspaces from "./ThreadWorkspace.ts";

const threadId = ThreadId.make("import:claude:../../workspace");
const at = DateTime.makeUnsafe("2026-11-05T12:00:00.000Z");
const item = {
  id: "decision",
  title: "Choose a direction",
  details: "Need input",
  status: "open",
} as const;
const harness = Effect.fn("test.workspaceHarness")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "thread-workspace-test-" });
  const configContext = yield* Layer.build(ServerConfig.layerTest(root, root));
  const config = Context.get(configContext, ServerConfig.ServerConfig);
  const projection = emptyProjection({
    id: EventId.make("created"),
    type: "thread.created",
    threadId,
    occurredAt: at,
    payload: {
      id: threadId,
      createdBy: "user",
      creationSource: "web",
      projectId: ProjectId.make("project"),
      title: "Thread",
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "default" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      deletedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
    },
  });
  let deleted = false;
  let threadFailure: Orchestrator.OrchestratorProjectionError | null = null;
  const dependencies = Layer.mergeAll(
    Layer.succeed(ServerConfig.ServerConfig, config),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadRecords: () =>
        threadFailure !== null
          ? Effect.fail(threadFailure)
          : Effect.succeed({
              ...projection,
              thread: { ...projection.thread, deletedAt: deleted ? at : null },
            }),
    }),
  );
  const open = Effect.fn("test.openWorkspace")(function* () {
    const context = yield* Layer.build(
      Layer.fresh(Workspaces.layer).pipe(Layer.provide(dependencies)),
    );
    return Context.get(context, Workspaces.ThreadWorkspace);
  });
  return {
    service: yield* open(),
    open,
    fs,
    path,
    directory: path.join(config.stateDir, "thread-workspaces"),
    file: path.join(
      config.stateDir,
      "thread-workspaces",
      `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`,
    ),
    setDeleted: () => {
      deleted = true;
    },
    setThreadFailure: (failure: typeof threadFailure) => {
      threadFailure = failure;
    },
  };
});

it.effect(
  "persists partial edits across reconstruction and rejects stale writes without losing other sections",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      expect(yield* h.service.get({ threadId })).toEqual({
        threadId,
        revision: 0,
        actionItems: [],
        designNotes: "",
        summaryNotes: "",
        updatedAt: null,
      });
      expect(yield* h.fs.exists(h.directory)).toBe(false);
      const saved = yield* h.service.patch({
        threadId,
        expectedRevision: 0,
        actionItems: [item],
        designNotes: "Use a small module",
      });
      expect(saved.revision).toBe(1);
      expect(saved.updatedAt).not.toBeNull();
      const reopened = yield* h.open();
      expect(yield* reopened.get({ threadId })).toEqual(saved);
      const next = yield* reopened.patch({
        threadId,
        expectedRevision: 1,
        summaryNotes: "Direction chosen",
        actionItems: [{ ...item, status: "deferred" }],
      });
      expect(next.designNotes).toBe(saved.designNotes);
      expect(next.actionItems[0]?.status).toBe("deferred");
      const stale = yield* Effect.result(
        reopened.patch({ threadId, expectedRevision: 1, designNotes: "Overwrite" }),
      );
      expect(stale).toMatchObject({
        _tag: "Failure",
        failure: { code: "conflict", currentRevision: 2 },
      });
      expect(yield* reopened.get({ threadId })).toEqual(next);
      expect(yield* h.fs.readDirectory(h.directory)).toEqual([
        `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`,
      ]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("serializes simultaneous compare-and-save edits", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const results = yield* Effect.forEach(
      ["one", "two"],
      (summaryNotes) =>
        Effect.result(h.service.patch({ threadId, expectedRevision: 0, summaryNotes })),
      { concurrency: "unbounded" },
    );
    expect(results.filter(Result.isSuccess)).toHaveLength(1);
    expect(results.filter(Result.isFailure).map((result) => result.failure.code)).toEqual([
      "conflict",
    ]);
    expect((yield* h.service.get({ threadId })).revision).toBe(1);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "rejects duplicate action IDs and malformed saved documents instead of resetting them",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const invalid = yield* Effect.result(
        h.service.patch({ threadId, expectedRevision: 0, actionItems: [item, item] }),
      );
      expect(invalid).toMatchObject({ _tag: "Failure", failure: { code: "invalid" } });
      expect(yield* h.fs.exists(h.directory)).toBe(false);
      const saved = yield* h.service.patch({ threadId, expectedRevision: 0, actionItems: [item] });
      for (const contents of [
        "{bad json",
        JSON.stringify({ formatVersion: 1, workspace: { ...saved, threadId: "another-thread" } }),
        JSON.stringify({ formatVersion: 1, workspace: { ...saved, actionItems: [item, item] } }),
      ]) {
        yield* h.fs.writeFileString(h.file, contents);
        const failure = yield* Effect.result(h.service.get({ threadId }));
        expect(failure).toMatchObject({ _tag: "Failure", failure: { code: "storage" } });
        expect(yield* h.fs.readFileString(h.file)).toBe(contents);
      }
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "rejects deleted or missing threads and preserves unexpected thread and storage failures",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const missing = new Orchestrator.OrchestratorProjectionError({
        threadId,
        cause: new ProjectionStoreThreadNotFoundError({ threadId }),
      });
      h.setThreadFailure(missing);
      expect(yield* Effect.result(h.service.get({ threadId }))).toMatchObject({
        _tag: "Failure",
        failure: { code: "not_found", cause: missing },
      });
      const broken = new Orchestrator.OrchestratorProjectionError({
        threadId,
        cause: new Error("database unavailable"),
      });
      h.setThreadFailure(broken);
      expect(
        yield* Effect.result(
          h.service.patch({ threadId, expectedRevision: 0, summaryNotes: "No" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "thread", cause: broken } });
      h.setThreadFailure(null);
      yield* h.fs.writeFileString(h.directory, "blocks directory creation");
      expect(
        yield* Effect.result(
          h.service.patch({ threadId, expectedRevision: 0, summaryNotes: "No" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "storage", cause: expect.anything() } });
      h.setDeleted();
      expect(yield* Effect.result(h.service.get({ threadId }))).toMatchObject({
        _tag: "Failure",
        failure: { code: "not_found" },
      });
      expect(
        yield* Effect.result(
          h.service.patch({ threadId, expectedRevision: 0, summaryNotes: "No" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "not_found" } });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
