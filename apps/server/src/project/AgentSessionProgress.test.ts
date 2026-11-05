// @effect-diagnostics nodeBuiltinImport:off - Real file replacement and partial append exercise the provider transcript boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderDriverKind,
  type AgentSessionImportSource,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Progress from "./AgentSessionProgress.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { emptyProjection } from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectService from "./ProjectService.ts";
import { readSourceProgress } from "./AgentSessionProgress.ts";

const sessionId = "c4686232-61af-4e91-9555-eec59647564a";
const line = (text: string, extra = {}) =>
  JSON.stringify({
    type: "assistant",
    sessionId,
    timestamp: "2026-11-05T12:00:00.000Z",
    message: { content: [{ type: "text", text }] },
    ...extra,
  }) + "\n";

const fixture = (contents: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-progress-"));
      const filePath = NodePath.join(root, `${sessionId}.jsonl`);
      await NodeFSP.writeFile(filePath, contents);
      const stats = await NodeFSP.stat(filePath, { bigint: true });
      const source: AgentSessionImportSource = {
        provider: "claudeAgent",
        providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        providerSessionId: sessionId,
        filePath,
        device: Number(stats.dev),
        inode: String(stats.ino),
        size: Number(stats.size),
        mtimeMs: Number(stats.mtimeMs),
        birthtimeMs: Number(stats.birthtimeMs),
      };
      return { root, source };
    }),
    ({ root }) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
  );

it.effect("follows appended complete messages without importing an incomplete record", () =>
  Effect.gen(function* () {
    const { root, source } = yield* fixture(line("first"));
    yield* Effect.promise(() =>
      NodeFSP.appendFile(source.filePath, line("second") + '{"type":"assistant"'),
    );
    const result = yield* Effect.promise(() => readSourceProgress(source, root));
    expect(result.status).toBe("following");
    expect(result.messages.map((message) => message.text)).toEqual(["first", "second"]);
    expect(yield* Effect.promise(() => NodeFSP.readFile(source.filePath, "utf8"))).toContain(
      '{"type":"assistant"',
    );
  }).pipe(Effect.scoped),
);

it.effect("reads a bounded tail, excludes sidechains and returns the latest twenty messages", () =>
  Effect.gen(function* () {
    const contents =
      line("x".repeat(1024 * 1024)) +
      Array.from({ length: 25 }, (_, index) => line(`message ${index}`)).join("") +
      line("child", { isSidechain: true });
    const { root, source } = yield* fixture(contents);
    const result = yield* Effect.promise(() => readSourceProgress(source, root));
    expect(result.status).toBe("following");
    expect(result.truncated).toBe(true);
    expect(result.messages.map((message) => message.text)).toEqual(
      Array.from({ length: 20 }, (_, index) => `message ${index + 5}`),
    );
  }).pipe(Effect.scoped),
);

it.effect("rejects missing, replaced, truncated and out-of-home source files", () =>
  Effect.gen(function* () {
    const { root, source } = yield* fixture(line("original"));
    expect(
      (yield* Effect.promise(() => readSourceProgress(source, NodePath.join(root, "elsewhere"))))
        .status,
    ).toBe("unavailable");
    yield* Effect.promise(() => NodeFSP.writeFile(source.filePath, ""));
    expect((yield* Effect.promise(() => readSourceProgress(source, root))).status).toBe(
      "unavailable",
    );
    yield* Effect.promise(() => NodeFSP.rename(source.filePath, `${source.filePath}.old`));
    yield* Effect.promise(() => NodeFSP.writeFile(source.filePath, line("replacement")));
    expect((yield* Effect.promise(() => readSourceProgress(source, root))).status).toBe(
      "unavailable",
    );
    yield* Effect.promise(() => NodeFSP.unlink(source.filePath));
    expect((yield* Effect.promise(() => readSourceProgress(source, root))).status).toBe(
      "unavailable",
    );
  }).pipe(Effect.scoped),
);

it.effect(
  "follows an imported terminal source while its provider is disabled and stops after T3 continues",
  () =>
    Effect.gen(function* () {
      const { root, source: originalSource } = yield* fixture(line("first"));
      const projectsDirectory = NodePath.join(root, "projects");
      yield* Effect.promise(() => NodeFSP.mkdir(projectsDirectory));
      const source = {
        ...originalSource,
        filePath: NodePath.join(projectsDirectory, `${sessionId}.jsonl`),
      };
      yield* Effect.promise(() => NodeFSP.rename(originalSource.filePath, source.filePath));
      const threadId = ThreadId.make("import:claudeAgent:" + sessionId);
      const providerInstanceId = ProviderInstanceId.make("claudeAgent");
      const at = DateTime.makeUnsafe("2026-11-05T12:00:00.000Z");
      const modelSelection = { instanceId: providerInstanceId, model: "default" };
      const providerThreadId = ProviderThreadId.make("imported-provider-thread");
      const base = emptyProjection({
        id: EventId.make("import-created"),
        type: "thread.created",
        threadId,
        occurredAt: at,
        payload: {
          id: threadId,
          createdBy: "system",
          creationSource: "server",
          projectId: ProjectId.make("project"),
          title: "Imported",
          providerInstanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: providerThreadId,
          historyOrigin: "v1_import",
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
      const projection: OrchestrationV2ThreadProjection = {
        ...base,
        providerThreads: [
          {
            id: providerThreadId,
            driver: ProviderDriverKind.make("claudeAgent"),
            providerInstanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: {
              driver: ProviderDriverKind.make("claudeAgent"),
              nativeId: sessionId,
              strength: "strong" as const,
            },
            nativeConversationHeadRef: null,
            status: "idle" as const,
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            pendingBackgroundTasks: [],
            createdAt: at,
            updatedAt: at,
          },
        ],
      };
      const continued = {
        ...projection,
        runs: [
          {
            id: RunId.make("continued"),
            threadId,
            ordinal: 1,
            providerInstanceId,
            modelSelection,
            providerThreadId: null,
            userMessageId: MessageId.make("continued-message"),
            rootNodeId: null,
            activeAttemptId: null,
            status: "completed" as const,
            requestedAt: at,
            startedAt: at,
            completedAt: at,
            checkpointId: null,
            contextHandoffId: null,
          },
        ],
      };
      let current = projection;
      yield* Effect.gen(function* () {
        const service = yield* Progress.AgentSessionProgress;
        const first = yield* service.progress({ threadId });
        expect(first.status).toBe("following");
        expect(first.messages.map((message) => message.text)).toEqual(["first"]);
        yield* Effect.promise(() => NodeFSP.appendFile(source.filePath, line("second")));
        expect(
          (yield* service.progress({ threadId })).messages.map((message) => message.text),
        ).toEqual(["first", "second"]);
        current = continued;
        expect(yield* service.progress({ threadId })).toEqual({
          status: "continued",
          messages: [],
          updatedAt: null,
          truncated: false,
        });
        expect(continued.thread.historyOrigin).toBe("v1_import");
        expect(continued.runs[0]?.id).toBe("continued");
      }).pipe(
        Effect.provide(
          Progress.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(Orchestrator.OrchestratorV2)({
                  getThreadRecords: () => Effect.succeed(current),
                }),
                Layer.mock(ProviderSessionRuntime.ProviderSessionRuntimeRepository)({
                  getByThreadId: () =>
                    Effect.succeedSome({
                      threadId,
                      providerName: "claudeAgent",
                      providerInstanceId,
                      adapterKey: "claudeAgent",
                      runtimeMode: "full-access",
                      status: "stopped",
                      lastSeenAt: "2026-11-05T12:00:00.000Z",
                      resumeCursor: { threadId, resume: sessionId },
                      runtimePayload: { cwd: root, importedTranscripts: [source] },
                    }),
                }),
                Layer.mock(ProjectService.ProjectService)({
                  getById: () =>
                    Effect.succeedSome({
                      id: ProjectId.make("project"),
                      title: "Project",
                      workspaceRoot: root,
                      defaultModelSelection: null,
                      scripts: [],
                      createdAt: "2026-11-05T12:00:00.000Z",
                      updatedAt: "2026-11-05T12:00:00.000Z",
                      deletedAt: null,
                    }),
                }),
                ServerSettings.layerTest({
                  providerInstances: {
                    [providerInstanceId]: {
                      driver: ProviderDriverKind.make("claudeAgent"),
                      enabled: false,
                      config: { homePath: root },
                    },
                  },
                }),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped),
);

it.effect("rejects another native session even when its file identity matches", () =>
  Effect.gen(function* () {
    const { root, source } = yield* fixture(
      line("other", { sessionId: "c4686232-61af-4e91-9555-eec59647564b" }),
    );
    expect((yield* Effect.promise(() => readSourceProgress(source, root))).status).toBe(
      "unavailable",
    );
  }).pipe(Effect.scoped),
);
