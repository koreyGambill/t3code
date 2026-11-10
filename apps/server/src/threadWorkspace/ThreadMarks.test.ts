// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import { expect, it } from "@effect/vitest";
import {
  CheckpointId,
  RunId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  MessageId,
  type OrchestrationV2ConversationMessage,
  type ThreadMarkAnnotation,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { emptyProjection } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadMarks from "./ThreadMarks.ts";
const threadId = ThreadId.make("marks-thread");
const at = DateTime.makeUnsafe("2026-11-06T12:00:00Z");
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
    title: "Marks",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "default" },
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
const message = (id: string, text: string, date: string): OrchestrationV2ConversationMessage => ({
  id: MessageId.make(id),
  threadId,
  runId: null,
  nodeId: null,
  role: "assistant",
  createdBy: "user",
  creationSource: "web",
  text,
  attachments: [],
  streaming: false,
  createdAt: DateTime.makeUnsafe(date),
  updatedAt: DateTime.makeUnsafe(date),
});
const getMarksWithConfig = (deleted: boolean, annotation?: ThreadMarkAnnotation) =>
  ThreadMarks.ThreadMarks.pipe(
    Effect.flatMap((service) =>
      annotation ? service.annotate({ threadId, annotation }) : service.get({ threadId }),
    ),
    Effect.provide(
      ThreadMarks.layer.pipe(
        Layer.provide(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            listDevelopmentEnvironmentUsage: () =>
              Effect.succeed([
                {
                  threadId,
                  projectId: ProjectId.make("project"),
                  xwingEnvironmentId: "0123abcd",
                  repositorySource: "/repo",
                  checkoutPath: "/x/envs/12/repo",
                  number: 12,
                  name: "feature",
                  firstSelectedAt: "2026-10-15T00:00:00.000Z",
                  lastSelectedAt: "2026-10-16T00:00:00.000Z",
                  threadTitle: "Marks",
                  archivedAt: null,
                  settledAt: null,
                  current: true,
                },
              ]),
          }),
        ),
        Layer.provide(
          Layer.mock(Orchestrator.OrchestratorV2)({
            getThreadRecords: () =>
              Effect.succeed({
                ...projection,
                runs: [
                  {
                    id: RunId.make("finished-run"),
                    status: "completed" as const,
                    threadId,
                    ordinal: 1,
                    providerInstanceId: projection.thread.providerInstanceId,
                    modelSelection: projection.thread.modelSelection,
                    providerThreadId: null,
                    userMessageId: MessageId.make("message"),
                    rootNodeId: null,
                    activeAttemptId: null,
                    requestedAt: at,
                    startedAt: null,
                    completedAt: at,
                    checkpointId: null,
                    contextHandoffId: null,
                  },
                ],
                thread: { ...projection.thread, deletedAt: deleted ? at : null },
                messages: [
                  message(
                    "latest",
                    "https://notion.so/repeated https://github.com/new",
                    "2026-11-06T12:00:00Z",
                  ),
                  message(
                    "old",
                    "https://notion.so/old https://notion.so/repeated",
                    "2026-10-01T12:00:00Z",
                  ),
                ],
              }),
          }),
        ),
      ),
    ),
  );

const getMarks = (deleted: boolean) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "thread-marks-test-" });
    return yield* getMarksWithConfig(deleted).pipe(
      Effect.provide(ServerConfig.layerTest(root, root)),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

it.effect(
  "derives compact marks across full message history and keeps the earliest duplicate timestamp",
  () =>
    Effect.gen(function* () {
      const marks = yield* getMarks(false);
      expect(marks.map((mark) => mark.url)).toEqual([
        "https://notion.so/old",
        "https://notion.so/repeated",
        "xwing-environment:0123abcd",
        "https://github.com/new",
      ]);
      expect(marks[2]).toMatchObject({
        service: "Xwing",
        description: "#12 feature, current checkout",
        link: { type: "xwing_environment", xwingEnvironmentId: "0123abcd" },
      });
      expect(marks[1]?.timestamp).toBe("2026-10-01T12:00:00.000Z");
      expect(marks[0]?.description).toBe("");
    }),
);
it.effect("refuses deleted thread data", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(getMarks(true));
    expect(Result.isFailure(result) && result.failure.message).toBe("This thread was deleted.");
  }),
);

it.effect(
  "reads legacy annotations before migration and retains their context point outside Workspace",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "thread-marks-migration-" });
      yield* Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const directory = path.join(config.stateDir, "thread-workspaces");
        const file = path.join(
          directory,
          `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`,
        );
        const annotation = {
          url: "https://notion.so/repeated",
          description: "Useful context",
          name: "Before implementation",
          contextSource: {
            threadId,
            runId: RunId.make("finished-run"),
            checkpointId: CheckpointId.make("checkpoint"),
          },
        };
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(
          file,
          JSON.stringify({
            formatVersion: 2,
            workspace: { threadId, markAnnotations: [annotation] },
          }),
        );
        expect(
          (yield* getMarksWithConfig(false)).find((mark) => mark.url === annotation.url),
        ).toMatchObject(annotation);
        expect(
          (yield* getMarksWithConfig(false, {
            ...annotation,
            description: "Annotated context",
          })).find((mark) => mark.url === annotation.url)?.description,
        ).toBe("Annotated context");
        const persisted = { ...annotation, description: "Annotated context" };
        yield* Effect.all(
          [
            getMarksWithConfig(false, {
              url: "https://notion.so/old",
              description: "First",
              name: "First name",
            }),
            getMarksWithConfig(false, {
              url: "https://github.com/new",
              description: "Second",
              name: "Second name",
            }),
            ThreadMarks.migrateAnnotations(
              threadId,
              JSON.stringify({ workspace: { markAnnotations: [annotation] } }),
            ),
          ],
          { concurrency: 2 },
        );
        const annotations = yield* ThreadMarks.readAnnotations(threadId);
        expect(annotations).toEqual(
          expect.arrayContaining([
            persisted,
            expect.objectContaining({ url: "https://notion.so/old", name: "First name" }),
            expect.objectContaining({ url: "https://github.com/new", name: "Second name" }),
          ]),
        );
        yield* fs.writeFileString(
          file,
          JSON.stringify({ formatVersion: 3, workspace: { threadId } }),
        );
        expect(yield* ThreadMarks.readAnnotations(threadId)).toEqual(annotations);
        expect(
          (yield* getMarksWithConfig(false)).find((mark) => mark.url === annotation.url),
        ).toMatchObject(persisted);
      }).pipe(Effect.provide(ServerConfig.layerTest(root, root)));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
