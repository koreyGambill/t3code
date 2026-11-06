// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import {
  ThreadWorkspace as Workspace,
  ThreadWorkspaceError,
  type ThreadWorkspaceGetInput,
  type ThreadWorkspacePatchInput,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { ProjectionStoreThreadNotFoundError } from "../orchestration-v2/ProjectionStore.ts";

export class ThreadWorkspace extends Context.Service<
  ThreadWorkspace,
  {
    readonly get: (
      input: ThreadWorkspaceGetInput,
    ) => Effect.Effect<Workspace, ThreadWorkspaceError>;
    readonly patch: (
      input: ThreadWorkspacePatchInput,
    ) => Effect.Effect<Workspace, ThreadWorkspaceError>;
  }
>()("t3/threadWorkspace/ThreadWorkspace") {}

const PersistedWorkspace = Schema.Struct({
  formatVersion: Schema.Literal(1),
  workspace: Workspace,
});
const decodeWorkspace = Schema.decodeEffect(Schema.fromJsonString(PersistedWorkspace));
const encodeWorkspace = Schema.encodeEffect(Schema.fromJsonString(PersistedWorkspace));
const isMissingThread = Schema.is(ProjectionStoreThreadNotFoundError);
const isProjectionError = Schema.is(Orchestrator.OrchestratorProjectionError);

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const lock = yield* Semaphore.make(1);
  const directory = path.join(config.stateDir, "thread-workspaces");
  const filePath = (threadId: Workspace["threadId"]) =>
    path.join(directory, `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`);
  const requireThread = Effect.fn("ThreadWorkspace.requireThread")(function* (
    threadId: Workspace["threadId"],
  ) {
    const records = yield* orchestrator.getThreadRecords(threadId, []).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: isProjectionError(cause) && isMissingThread(cause.cause) ? "not_found" : "thread",
            operation: "loadThread",
            message: "Could not load the workspace's thread.",
            cause,
          }),
      ),
    );
    if (records.thread.deletedAt !== null)
      return yield* new ThreadWorkspaceError({
        code: "not_found",
        operation: "loadThread",
        message: "The workspace's thread was deleted.",
      });
  });
  const read = Effect.fn("ThreadWorkspace.read")(function* (threadId: Workspace["threadId"]) {
    const contents = yield* fs.readFileString(filePath(threadId)).pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: "storage",
            operation: "read",
            message: "Could not read the thread workspace.",
            cause,
          }),
      ),
    );
    if (contents === null)
      return {
        threadId,
        revision: 0,
        actionItems: [],
        designNotes: "",
        summaryNotes: "",
        updatedAt: null,
      } satisfies Workspace;
    const { workspace } = yield* decodeWorkspace(contents).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: "storage",
            operation: "decode",
            message: "The saved thread workspace is malformed.",
            cause,
          }),
      ),
    );
    if (
      workspace.threadId !== threadId ||
      new Set(workspace.actionItems.map((item) => item.id)).size !== workspace.actionItems.length
    )
      return yield* new ThreadWorkspaceError({
        code: "storage",
        operation: "validate",
        message: "The saved thread workspace is malformed.",
      });
    return workspace;
  });
  const get = Effect.fn("ThreadWorkspace.get")(function* (input: ThreadWorkspaceGetInput) {
    yield* requireThread(input.threadId);
    return yield* read(input.threadId);
  });
  const patch = Effect.fn("ThreadWorkspace.patch")(function* (input: ThreadWorkspacePatchInput) {
    yield* requireThread(input.threadId);
    const current = yield* read(input.threadId);
    if (current.revision !== input.expectedRevision)
      return yield* new ThreadWorkspaceError({
        code: "conflict",
        operation: "patch",
        message: "The workspace changed. Reload it before saving again.",
        currentRevision: current.revision,
      });
    const actionItems = input.actionItems ?? current.actionItems;
    if (new Set(actionItems.map((item) => item.id)).size !== actionItems.length)
      return yield* new ThreadWorkspaceError({
        code: "invalid",
        operation: "patch",
        message: "Action item IDs must be unique within the workspace.",
      });
    const workspace: Workspace = {
      threadId: input.threadId,
      revision: current.revision + 1,
      actionItems,
      designNotes: input.designNotes ?? current.designNotes,
      summaryNotes: input.summaryNotes ?? current.summaryNotes,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    const contents = yield* encodeWorkspace({ formatVersion: 1, workspace }).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: "storage",
            operation: "encode",
            message: "Could not encode the thread workspace.",
            cause,
          }),
      ),
    );
    yield* writeFileStringAtomically({ filePath: filePath(input.threadId), contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: "storage",
            operation: "write",
            message: "Could not save the thread workspace.",
            cause,
          }),
      ),
    );
    return workspace;
  }, lock.withPermit);
  return ThreadWorkspace.of({ get, patch });
});

export const layer = Layer.effect(ThreadWorkspace, make);
