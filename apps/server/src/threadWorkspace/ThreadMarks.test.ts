import { expect, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  MessageId,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
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
const getMarks = (deleted: boolean) =>
  ThreadMarks.ThreadMarks.pipe(
    Effect.flatMap((service) => service.get({ threadId })),
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
