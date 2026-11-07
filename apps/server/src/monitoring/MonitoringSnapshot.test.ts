import { assert, it } from "@effect/vitest";
import {
  MonitoringProfileId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  MessageId,
  type MonitoringReviewOutput,
  type MonitoringProfile,
} from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Snapshot from "./MonitoringSnapshot.ts";
const at = "1970-01-01T00:00:00.000Z";
const profile: MonitoringProfile = {
  id: MonitoringProfileId.make("p"),
  scheduledTaskId: ScheduledTaskId.make("monitoring:p"),
  title: "Watcher",
  enabled: true,
  projectId: ProjectId.make("project"),
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "haiku" },
  schedule: { type: "interval", everyMs: 60000 },
  targets: {
    state: "active",
    threadIds: [ThreadId.make("chosen")],
    includeChildren: true,
    minAgeMs: 0,
    updatedWithinMs: null,
  },
  rules: [{ id: "r", title: "Rule", instructions: "Evidence" }],
  createdAt: at,
  updatedAt: at,
};
it.effect(
  "decodes persisted ISO timestamps, selects explicit threads and validates observed evidence",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      for (const id of ["chosen", "excluded"]) {
        const payload = JSON.stringify({
          id,
          projectId: "project",
          title: id,
          providerInstanceId: "claude",
          modelSelection: { instanceId: "claude", model: "haiku" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
          forkedFrom: null,
          createdBy: "user",
          creationSource: "web",
          createdAt: at,
          updatedAt: at,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        });
        yield* sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES (${id},'project',${id},'claude','full-access','default',${at},${at},${payload})`;
        for (const streaming of [false, true]) {
          const mid = id + (streaming ? ":stream" : ":done");
          const message = JSON.stringify({
            id: mid,
            threadId: id,
            runId: null,
            nodeId: null,
            role: "assistant",
            text: streaming ? "partial" : "Tests 3 passed",
            attachments: [],
            streaming,
            createdAt: at,
            updatedAt: at,
            createdBy: "agent",
            creationSource: "server",
          });
          yield* sql`INSERT INTO orchestration_v2_projection_messages(message_id,thread_id,role,streaming,created_at,updated_at,payload_json) VALUES (${mid},${id},'assistant',${streaming ? 1 : 0},${at},${at},${message})`;
        }
      }
      const before = yield* sql`SELECT count(*) AS count FROM orchestration_v2_projection_messages`;
      const snap = yield* (yield* Snapshot.MonitoringSnapshot).capture(profile);
      assert.deepEqual(
        snap.threads.map((t) => t.id),
        ["chosen"],
      );
      assert.deepEqual(
        snap.threads[0]?.messages.map((m) => m.text),
        ["Tests 3 passed"],
      );
      assert.equal(snap.truncated, false);
      assert.include(snap.coverage, "files were not inspected");
      assert.deepEqual(
        yield* sql`SELECT count(*) AS count FROM orchestration_v2_projection_messages`,
        before,
      );
      const finding: MonitoringReviewOutput["findings"][number] = {
        ruleId: "r",
        threadId: ThreadId.make("chosen"),
        summary: "Missing evidence",
        detail: "Observed",
        confidence: 0.8,
        evidence: [
          {
            threadId: ThreadId.make("chosen"),
            messageId: MessageId.make("chosen:done"),
            excerpt: "Tests 3 passed",
          },
        ],
      };
      assert.equal(
        Snapshot.validateMonitoringEvidence({ findings: [finding] }, profile, snap),
        true,
      );
      assert.equal(
        Snapshot.validateMonitoringEvidence(
          {
            findings: [
              { ...finding, evidence: [{ ...finding.evidence[0]!, excerpt: "not observed" }] },
            ],
          },
          profile,
          snap,
        ),
        false,
      );
      assert.equal(
        Snapshot.validateMonitoringEvidence(
          { findings: [{ ...finding, ruleId: "unknown" }] },
          profile,
          snap,
        ),
        false,
      );
    }).pipe(Effect.provide(Snapshot.layer.pipe(Layer.provideMerge(Sqlite.layerMemory)))),
);
