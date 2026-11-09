import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { McpSchema, McpServer } from "effect/ai";

import * as MonitoringDialogue from "../../../monitoring/MonitoringDialogue.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as ScheduledTasks from "../../../scheduledTasks/ScheduledTaskService.ts";
import * as ContextRecords from "../../../threadInsights/ContextRecords.ts";
import * as Footprints from "../../../threadInsights/InstructionFootprints.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";

it.effect("defaults to compact context pages and lets callers request full tool lists", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const threadId = ThreadId.make("context-reader");
    const at = "2026-11-09T12:00:00.000Z";
    yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES (${threadId},'project','Context','codex','full-access','default',${at},${at},'{}')`;
    for (const ordinal of [1, 2, 3, 4, 5]) {
      const runId = `context-${ordinal}`;
      yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id,thread_id,ordinal,provider,status,requested_at,payload_json) VALUES (${runId},${threadId},${ordinal},'codex','completed',${at},'{}')`;
    }
    const scope: Invocation.McpInvocationScope = {
      environmentId: EnvironmentId.make("context-environment"),
      requestNamespace: "context-session",
      issuedAt: 0,
      capabilities: new Set(["orchestration"]),
      thread: {
        threadId,
        providerSessionId: "context-session",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
    };
    const client = McpSchema.McpServerClient.of({
      clientId: 1,
      protocolVersion: "2025-06-18",
      clientCapabilities: {},
      clientInfo: { name: "context-test", version: "1" },
      initializePayload: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "context-test", version: "1" },
      },
      getClient: Effect.die("unused"),
    });
    const server = yield* McpServer.McpServer;
    const compact = yield* server
      .callTool({ name: "t3_context_read", arguments: {} })
      .pipe(
        Effect.provideService(Invocation.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(compact.isError).not.toBe(true);
    expect(compact.structuredContent).toMatchObject({
      threadId,
      records: [{ ordinal: 5 }, { ordinal: 4 }, { ordinal: 3 }],
      nextBeforeOrdinal: 3,
    });
    expect(Buffer.byteLength(JSON.stringify(compact.structuredContent))).toBeLessThanOrEqual(24000);
    expect(JSON.stringify(compact.structuredContent)).not.toContain('"tool-0"');
    expect(JSON.stringify(compact.structuredContent)).toContain('"injectedToolCount":256');
    const expanded = yield* server
      .callTool({
        name: "t3_context_read",
        arguments: {
          beforeOrdinal: 3,
          limit: 1,
          maxBytes: 160000,
          includeInjectedTools: true,
        },
      })
      .pipe(
        Effect.provideService(Invocation.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(expanded.isError).not.toBe(true);
    expect(expanded.structuredContent).toMatchObject({
      threadId,
      records: [
        { ordinal: 2, instructions: [{ injectedTools: expect.arrayContaining(["tool-0"]) }] },
      ],
      nextBeforeOrdinal: 2,
    });
  }).pipe(
    Effect.provide(
      McpHttpServer.layerThreadToolkit.pipe(
        Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(NodeCrypto.layer),
        Layer.provide(Layer.mock(MonitoringDialogue.MonitoringDialogue)({})),
        Layer.provide(Layer.mock(ThreadSearch.ThreadSearch)({})),
        Layer.provide(Layer.mock(ScheduledTasks.ScheduledTaskService)({})),
        Layer.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
            getProjectThreadRecords: ({ threadId }) =>
              Effect.succeed(idleThreadProjection(liveThreadShell(threadId))),
          }),
        ),
        Layer.provide(
          ContextRecords.layer.pipe(
            Layer.provide(
              Layer.mock(Footprints.InstructionFootprints)({
                list: (threadId, runId) =>
                  Effect.succeed([
                    {
                      threadId,
                      runId: runId!,
                      providerInstanceId: ProviderInstanceId.make("codex"),
                      driver: "codex",
                      model: "test",
                      capturedAt: "2026-11-09T12:00:00.000Z",
                      source: "test",
                      parts: [],
                      injectedToolCount: 256,
                      injectedTools: Array.from({ length: 256 }, (_, index) => `tool-${index}`),
                    },
                  ]),
              }),
            ),
          ),
        ),
      ),
    ),
    Effect.provide(Sqlite.layerMemory),
  ),
);
