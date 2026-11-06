import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  ReviewId,
  ThreadId,
  type ReviewArtifact,
  type ThreadWorkspace as ThreadWorkspaceDocument,
  ThreadWorkspaceError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import { ThreadWorkspace } from "../../../threadWorkspace/ThreadWorkspace.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ReviewArtifacts from "../../../reviewArtifacts/ReviewArtifacts.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";

const threadId = ThreadId.make("review-caller");
const targetId = ThreadId.make("review-target");
const reviewId = ReviewId.make("00000000-0000-4000-8000-000000000001");
const content = { title: "Deployment choices", summary: "Choose a rollout.", sections: [] };
const artifact: ReviewArtifact = {
  id: reviewId,
  threadId,
  content,
  revision: 1,
  draft: { answers: {}, annotations: [], notes: "Unfinished private notes", remindAt: null },
  lastSubmission: {
    revision: 1,
    messageId: MessageId.make("submitted-review"),
    submittedAt: "2026-01-01T00:00:00.000Z",
    markdown: "Approved the gradual rollout.",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const workspace: ThreadWorkspaceDocument = {
  threadId,
  revision: 3,
  actionItems: [
    {
      id: "credentials",
      title: "Provide credentials",
      details: "Use the secure form.",
      status: "deferred",
    },
  ],
  designNotes: "Keep deployment reversible.",
  summaryNotes: "Rollout implementation is in progress.",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const scope: Invocation.McpInvocationScope = {
  environmentId: EnvironmentId.make("review-environment"),
  requestNamespace: "review-session",
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
  thread: {
    threadId,
    providerSessionId: "review-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "review-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "review-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const call = (
  name: string,
  args: Record<string, unknown>,
  invocation = scope,
  missingOwner = false,
) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({ name, arguments: args })
      .pipe(
        Effect.provideService(Invocation.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  }).pipe(
    Effect.provide(
      McpHttpServer.layerReviewToolkit.pipe(
        Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(
          Layer.mock(ThreadWorkspace)({
            get: ({ threadId }) => Effect.succeed({ ...workspace, threadId }),
            patch: ({ threadId, expectedRevision, ...fields }) =>
              expectedRevision === workspace.revision
                ? Effect.succeed({
                    ...workspace,
                    actionItems: fields.actionItems ?? workspace.actionItems,
                    designNotes: fields.designNotes ?? workspace.designNotes,
                    summaryNotes: fields.summaryNotes ?? workspace.summaryNotes,
                    threadId,
                    revision: workspace.revision + 1,
                  })
                : Effect.fail(
                    new ThreadWorkspaceError({
                      code: "conflict",
                      message: "Workspace changed; read it again.",
                    }),
                  ),
          }),
        ),
        Layer.provide(
          Layer.mock(ReviewArtifacts.ReviewArtifacts)({
            create: (input) => Effect.succeed({ ...artifact, ...input }),
            getPublished: () =>
              Effect.succeed({
                id: reviewId,
                threadId,
                content,
                lastSubmission: artifact.lastSubmission,
              }),
          }),
        ),
        Layer.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: (id) =>
              Effect.succeed(
                missingOwner
                  ? null
                  : liveThreadShell(
                      id,
                      id === threadId
                        ? { runtimeMode: "approval-required", interactionMode: "plan" }
                        : {},
                    ),
              ),
            getProjectThreadRecords: ({ threadId: id }) =>
              Effect.succeed(idleThreadProjection(liveThreadShell(id))),
          }),
        ),
      ),
    ),
  );

const failureCode = (result: McpSchema.CallToolResult) => {
  const block = result.content[0];
  return result.isError && block?.type === "text" ? JSON.parse(block.text).code : undefined;
};

it.effect("publishes to the calling planning thread without exposing draft data", () =>
  Effect.gen(function* () {
    const result = yield* call("review_create", { content });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ reviewId, threadId });
  }),
);

it.effect("checks cross-thread mode limits before publication", () =>
  Effect.gen(function* () {
    const result = yield* call("review_create", { threadId: targetId, content });
    expect(failureCode(result)).toBe("runtime_mode_escalation_denied");
  }),
);

it.effect("requires an outside client's target and publishes to that exact thread", () =>
  Effect.gen(function* () {
    const invocation: Invocation.McpInvocationScope = {
      ...scope,
      thread: undefined,
      client: { sessionId: "client", label: "Publisher", access: "full-access" },
    };
    const missingTarget = yield* call("review_create", { content }, invocation);
    expect(failureCode(missingTarget)).toBe("target_required");
    const published = yield* call("review_create", { threadId: targetId, content }, invocation);
    expect(published.structuredContent).toEqual({ reviewId, threadId: targetId });
  }),
);

it.effect("lets a read-only client read submitted feedback but refuses publication", () =>
  Effect.gen(function* () {
    const invocation: Invocation.McpInvocationScope = {
      ...scope,
      thread: undefined,
      client: { sessionId: "client", label: "Reader", access: "read-only" },
    };
    const published = yield* call("review_read", { reviewId }, invocation);
    expect(published.structuredContent).toEqual({
      id: reviewId,
      threadId,
      content,
      lastSubmission: artifact.lastSubmission,
    });
    const create = yield* call("review_create", { threadId, content }, invocation);
    expect(failureCode(create)).toBe("capability_denied");
    const read = yield* call("thread_workspace_read", { threadId }, invocation);
    expect(read.structuredContent).toEqual(workspace);
    const update = yield* call(
      "thread_workspace_update",
      { threadId, expectedRevision: 3, summaryNotes: "Changed" },
      invocation,
    );
    expect(failureCode(update)).toBe("capability_denied");
  }),
);

it.effect.each([
  "review_create",
  "review_read",
  "thread_workspace_read",
  "thread_workspace_update",
])("requires orchestration access for %s", (name) =>
  Effect.gen(function* () {
    const result = yield* call(
      name,
      { content, reviewId, expectedRevision: 3 },
      { ...scope, capabilities: new Set() },
    );
    expect(failureCode(result)).toBe("capability_denied");
  }),
);

it.effect("refuses reading a review whose owning thread is unavailable", () =>
  Effect.gen(function* () {
    const result = yield* call("review_read", { reviewId }, scope, true);
    expect(failureCode(result)).toBe("thread_not_found");
    expect(result.structuredContent).toBeUndefined();
  }),
);

it.effect(
  "reads and updates the calling planning thread without changing unrelated workspace fields",
  () =>
    Effect.gen(function* () {
      const read = yield* call("thread_workspace_read", {});
      expect(read.structuredContent).toEqual(workspace);
      const update = yield* call("thread_workspace_update", {
        expectedRevision: 3,
        summaryNotes: "Ready for testing.",
      });
      expect(update.structuredContent).toEqual({
        ...workspace,
        revision: 4,
        summaryNotes: "Ready for testing.",
      });
      const conflict = yield* call("thread_workspace_update", {
        expectedRevision: 2,
        summaryNotes: "Stale.",
      });
      expect(failureCode(conflict)).toBe("invalid_request");
    }),
);

it.effect("applies workspace target and ownership checks before access", () =>
  Effect.gen(function* () {
    const invocation: Invocation.McpInvocationScope = {
      ...scope,
      thread: undefined,
      client: { sessionId: "client", label: "Publisher", access: "full-access" },
    };
    const missing = yield* call("thread_workspace_read", {}, invocation);
    expect(failureCode(missing)).toBe("target_required");
    const explicit = yield* call(
      "thread_workspace_update",
      { threadId: targetId, expectedRevision: 3, summaryNotes: "Target summary." },
      invocation,
    );
    expect(explicit.structuredContent).toEqual({
      ...workspace,
      threadId: targetId,
      revision: 4,
      summaryNotes: "Target summary.",
    });
    const escalated = yield* call("thread_workspace_update", {
      threadId: targetId,
      expectedRevision: 3,
      summaryNotes: "Target summary.",
    });
    expect(failureCode(escalated)).toBe("runtime_mode_escalation_denied");
    const unavailable = yield* call("thread_workspace_read", {}, scope, true);
    expect(failureCode(unavailable)).toBe("thread_not_found");
    expect(unavailable.structuredContent).toBeUndefined();
  }),
);
