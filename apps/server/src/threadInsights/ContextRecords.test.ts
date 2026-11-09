import { expect, it } from "@effect/vitest";
import { RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Footprints from "./InstructionFootprints.ts";
import * as Records from "./ContextRecords.ts";

it.effect(
  "derives repeats and knowledge reads from retained items, scopes usage, and pages recent turns",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const at = "2026-11-09T12:00:00.000Z";
      const threadId = ThreadId.make("context-thread");
      yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES (${threadId},'project','Context','claude','full-access','default',${at},${at},'{}')`;
      for (const ordinal of [1, 2]) {
        const runId = `run-${ordinal}`;
        const payload = JSON.stringify({
          modelSelection: { model: "haiku", instanceId: "claude" },
        });
        yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id,thread_id,ordinal,provider,status,requested_at,payload_json) VALUES (${runId},${threadId},${ordinal},'claude','completed',${at},${payload})`;
      }
      for (const [id, input] of [
        ["a", "cat /repo/AGENTS.md"],
        ["b", "sed -n '1,20p' /repo/AGENTS.md"],
        ["c", "overwing search context engines"],
      ]) {
        const payload = JSON.stringify({
          id,
          threadId,
          runId: "run-2",
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "completed",
          title: null,
          startedAt: at,
          completedAt: at,
          updatedAt: at,
          type: "command_execution",
          input,
          output: "é".repeat(6000),
          exitCode: 0,
        });
        yield* sql`INSERT INTO orchestration_v2_projection_turn_items (turn_item_id,thread_id,run_id,ordinal,type,status,updated_at,payload_json) VALUES (${id},${threadId},'run-2',1,'command_execution','completed',${at},${payload})`;
      }
      const records = yield* Records.ContextRecords;
      const result = yield* records.get({ threadId, limit: 1 });
      expect(result.nextBeforeOrdinal).toBe(2);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({
        runId: "run-2",
        repeatedReads: 1,
        inputTokens: null,
        usageStatus: "unavailable",
        truncated: false,
      });
      expect(result.records[0]?.reads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "/repo/AGENTS.md",
            count: 2,
            outputBytes: 24000,
            evidence: "inferred",
          }),
          expect.objectContaining({
            label: "overwing search context engines",
            kind: "knowledge",
            count: 1,
          }),
        ]),
      );
      expect(
        (yield* records.get({ threadId, beforeOrdinal: 2 })).records.map((record) => record.runId),
      ).toEqual([RunId.make("run-1")]);
      yield* sql`INSERT INTO orchestration_v2_projection_run_attempts (attempt_id,thread_id,run_id,attempt_ordinal,root_node_id,provider,provider_thread_id,status,payload_json) VALUES ('attempt',${threadId},'run-2',1,'node','claude','provider','completed','{}')`;
      const usage = JSON.stringify({
        turnTokenUsage: {
          usageScope: "main_agent",
          usageStatus: "complete",
          inputTokens: 1000,
          cachedInputTokens: 800,
          outputTokens: 100,
          hasSubagents: false,
        },
      });
      yield* sql`INSERT INTO orchestration_v2_projection_provider_turns (provider_turn_id,thread_id,provider_thread_id,node_id,run_attempt_id,ordinal,status,payload_json) VALUES ('turn',${threadId},'provider','node','attempt',1,'completed',${usage})`;
      expect((yield* records.get({ threadId })).records[0]).toMatchObject({
        inputTokens: 1000,
        cachedInputTokens: 800,
        outputTokens: 100,
        usageStatus: "complete",
      });

      expect(
        yield* Effect.result(records.get({ threadId: ThreadId.make("missing") })),
      ).toMatchObject({ _tag: "Failure" });
    }).pipe(
      Effect.provide(
        Records.layer.pipe(
          Layer.provide(
            Layer.mock(Footprints.InstructionFootprints)({ list: () => Effect.succeed([]) }),
          ),
          Layer.provideMerge(Sqlite.layerMemory),
        ),
      ),
    ),
);
