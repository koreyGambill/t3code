import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  ThreadWorkspaceError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";
import { ThreadWorkspace, emptyWorkspace } from "../../../threadWorkspace/ThreadWorkspace.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
const threadId = ThreadId.make("list-caller");
const targetId = ThreadId.make("list-target");
const workspace = {
  ...emptyWorkspace(threadId),
  revision: 3,
  artifacts: [
    {
      id: "design",
      title: "Design",
      format: "markdown" as const,
      versions: [
        {
          version: 1,
          title: "Design",
          format: "markdown" as const,
          content: "Saved",
          questions: [],
          answers: {
            draft: { chosenOptionIds: [], notes: "Private", submittedAt: null },
            submitted: {
              chosenOptionIds: [],
              notes: "Public",
              submittedAt: "2026-01-01T00:00:00.000Z",
            },
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  ],
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
            listRead: ({ allThreads }) =>
              Effect.succeed([
                {
                  threadId: allThreads ? targetId : threadId,
                  threadTitle: "List",
                  revision: 3,
                  items: [],
                  summaryNotes: "",
                  childPreamble: "",
                },
              ]),
            update: ({ threadId, expectedRevision }) =>
              expectedRevision === 3
                ? Effect.succeed({ ...workspace, threadId, revision: 4 })
                : Effect.fail(
                    new ThreadWorkspaceError({ code: "conflict", message: "Read again." }),
                  ),
            rewrite: () => Effect.succeed({ ...workspace, revision: 4 }),
            artifactWrite: () => Effect.succeed({ ...workspace, revision: 4 }),
            artifactList: () =>
              Effect.succeed([
                {
                  id: "design",
                  title: "Design",
                  format: "markdown",
                  version: 2,
                  unansweredQuestions: 0,
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              ]),
            artifactRead: ({ version }) =>
              Effect.succeed({
                questions: [],
                answers: {},
                version: version ?? 2,
                title: "Design",
                format: "markdown",
                content: "Saved",
                createdAt: "2026-01-01T00:00:00.000Z",
              }),
          }),
        ),
        Layer.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: (id) =>
              Effect.succeed(
                missingOwner && id === targetId
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

it.effect("reads and updates the calling thread and reports revision conflicts", () =>
  Effect.gen(function* () {
    const read = yield* call("list_read", {});
    expect(read.structuredContent).toMatchObject([{ threadId, revision: 3 }]);
    const update = yield* call("list_update", { expectedRevision: 3, changes: [{ text: "Ship" }] });
    expect(update.structuredContent).toMatchObject({ threadId, revision: 4 });
    expect(failureCode(yield* call("list_update", { expectedRevision: 2, changes: [] }))).toBe(
      "invalid_request",
    );
  }),
);
it.effect("checks every thread in an all-threads read", () =>
  Effect.gen(function* () {
    const read = yield* call("list_read", { allThreads: true }, scope, true);
    expect(failureCode(read)).toBe("thread_not_found");
    expect(read.structuredContent).toBeUndefined();
  }),
);
it.effect("checks cross-thread write mode limits and read-only access", () =>
  Effect.gen(function* () {
    expect(
      failureCode(
        yield* call("list_rewrite", { threadId: targetId, expectedRevision: 3, items: [] }),
      ),
    ).toBe("runtime_mode_escalation_denied");
    const invocation: Invocation.McpInvocationScope = {
      ...scope,
      thread: undefined,
      client: { sessionId: "reader", label: "Reader", access: "read-only" },
    };
    expect(
      failureCode(
        yield* call(
          "artifact_write",
          { threadId, expectedRevision: 3, title: "Design", format: "markdown", content: "Saved" },
          invocation,
        ),
      ),
    ).toBe("capability_denied");
    expect(
      (yield* call("artifact_read", { threadId, id: "design", version: 1 }, invocation))
        .structuredContent,
    ).toMatchObject({ version: 1, content: "Saved" });
  }),
);
it.effect("exposes only the list and artifact schemas", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const tools = server.tools
      .map(({ tool }) => tool)
      .filter((tool) => /^(list_|artifact_|thread_workspace_|review_)/.test(tool.name));
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "artifact_list",
      "artifact_read",
      "artifact_write",
      "list_read",
      "list_rewrite",
      "list_update",
    ]);
    expect(
      tools.find((tool) => tool.name === "artifact_write")?.inputSchema.properties,
    ).toHaveProperty("format");
  }).pipe(
    Effect.provide(
      McpHttpServer.layerReviewToolkit.pipe(
        Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(Layer.mock(ThreadWorkspace)({})),
        Layer.provide(Layer.mock(ThreadManagement.ThreadManagementService)({})),
      ),
    ),
  ),
);

it.effect.each(["list_update", "list_rewrite", "artifact_write"])(
  "%s omits artifact contents and answer history",
  (name) =>
    Effect.gen(function* () {
      const result = yield* call(name, {
        expectedRevision: 3,
        changes: [],
        items: [],
        title: "Design",
        format: "markdown",
        content: "Saved",
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).not.toHaveProperty("artifacts");
      expect(result.structuredContent).not.toHaveProperty("answers");
      expect(result.structuredContent).not.toHaveProperty("content");
      if (name === "artifact_write")
        expect(result.structuredContent).toEqual({
          threadId,
          revision: 4,
          id: "design",
          title: "Design",
          format: "markdown",
          version: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          unansweredQuestions: 0,
        });
      else expect(result.structuredContent).toMatchObject({ threadId, revision: 4, items: [] });
      expect(JSON.stringify(result.structuredContent)).not.toContain("Private");
    }),
);
