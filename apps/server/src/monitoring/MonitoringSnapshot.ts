import {
  MonitoringError,
  OrchestrationV2AppThreadJson,
  OrchestrationV2ConversationMessageJson,
  type OrchestrationV2AppThread,
  type MonitoringProfile,
  type MonitoringReviewOutput,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const decodeThreads = Schema.decodeEffect(
  Schema.Array(Schema.fromJsonString(OrchestrationV2AppThreadJson)),
);
const decodeMessages = Schema.decodeEffect(
  Schema.Array(Schema.fromJsonString(OrchestrationV2ConversationMessageJson)),
);

export interface MonitoringSnapshotData {
  readonly threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly title: string;
    readonly parentThreadId: ThreadId | null;
    readonly messages: ReadonlyArray<{
      readonly id: string;
      readonly role: string;
      readonly text: string;
    }>;
  }>;
  readonly truncated: boolean;
  readonly coverage: string;
}

function monitoringTargetMatches(
  profile: MonitoringProfile,
  thread: OrchestrationV2AppThread,
  now: number,
): boolean {
  if (thread.deletedAt !== null || thread.projectId !== profile.projectId) return false;
  if (profile.targets.threadIds.length && !profile.targets.threadIds.includes(thread.id))
    return false;
  const closed =
    thread.archivedAt !== null ||
    thread.settledOverride === "settled" ||
    (thread.settledOverride !== "active" && thread.settledAt !== null);
  if (profile.targets.state === "active" && closed) return false;
  if (profile.targets.state === "closed" && !closed) return false;
  if (now - DateTime.toEpochMillis(thread.createdAt) < profile.targets.minAgeMs) return false;
  return (
    profile.targets.updatedWithinMs === null ||
    now - DateTime.toEpochMillis(thread.updatedAt) <= profile.targets.updatedWithinMs
  );
}

export function validateMonitoringEvidence(
  output: MonitoringReviewOutput,
  profile: MonitoringProfile,
  snapshot: MonitoringSnapshotData,
): boolean {
  return output.findings.every(
    (finding) =>
      profile.rules.some((rule) => rule.id === finding.ruleId) &&
      snapshot.threads.some(
        (thread) => thread.id === finding.threadId && thread.parentThreadId === null,
      ) &&
      finding.evidence.every((evidence) =>
        snapshot.threads.some(
          (thread) =>
            (thread.id === finding.threadId || thread.parentThreadId === finding.threadId) &&
            thread.id === evidence.threadId &&
            thread.messages.some(
              (message) =>
                message.id === evidence.messageId && message.text.includes(evidence.excerpt),
            ),
        ),
      ),
  );
}

export class MonitoringSnapshot extends Context.Service<
  MonitoringSnapshot,
  {
    readonly capture: (
      profile: MonitoringProfile,
    ) => Effect.Effect<MonitoringSnapshotData, MonitoringError>;
  }
>()("t3/monitoring/MonitoringSnapshot") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return MonitoringSnapshot.of({
    capture: Effect.fn("MonitoringSnapshot.capture")(function* (profile) {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const rows = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM orchestration_v2_projection_threads WHERE project_id=${profile.projectId} AND deleted_at IS NULL AND ${profile.targets.threadIds.length ? sql`thread_id IN ${sql.in(profile.targets.threadIds)}` : sql`1`} ORDER BY updated_at DESC LIMIT 201`.pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError((cause) => new MonitoringError({ operation: "select targets", cause })),
      );
      const threads = yield* decodeThreads(rows.map((row) => row.payload_json)).pipe(
        Effect.mapError((cause) => new MonitoringError({ operation: "decode targets", cause })),
      );
      const selected = threads
        .filter((thread) => monitoringTargetMatches(profile, thread, now))
        .slice(0, 20);
      const result: Array<MonitoringSnapshotData["threads"][number]> = [];
      let remaining = 80_000;
      let truncated =
        rows.length > 200 ||
        selected.length <
          threads.filter((thread) => monitoringTargetMatches(profile, thread, now)).length;
      for (const root of selected) {
        const children = profile.targets.includeChildren
          ? yield* sql<{
              child_thread_id: string;
            }>`SELECT child_thread_id FROM orchestration_v2_projection_subagents WHERE thread_id=${root.id} AND child_thread_id IS NOT NULL ORDER BY updated_at DESC LIMIT 9`.pipe(
              NodeSqliteClient.readOnly,
              Effect.mapError(
                (cause) => new MonitoringError({ operation: "read children", cause }),
              ),
            )
          : [];
        if (children.length > 8) truncated = true;
        const ids = [
          { id: root.id, parentThreadId: null },
          ...children
            .slice(0, 8)
            .map((child) => ({ id: child.child_thread_id, parentThreadId: root.id })),
        ];
        for (const item of ids) {
          if (remaining <= 0) {
            truncated = true;
            break;
          }
          const records = yield* sql<{
            payload_json: string;
          }>`SELECT payload_json FROM orchestration_v2_projection_messages WHERE thread_id=${item.id} AND streaming=0 ORDER BY created_at DESC, message_id DESC LIMIT 41`.pipe(
            NodeSqliteClient.readOnly,
            Effect.mapError((cause) => new MonitoringError({ operation: "read messages", cause })),
          );
          if (records.length > 40) truncated = true;
          const messages = yield* decodeMessages(
            records
              .slice(0, 40)
              .reverse()
              .map((record) => record.payload_json),
          ).pipe(
            Effect.mapError(
              (cause) => new MonitoringError({ operation: "decode messages", cause }),
            ),
          );
          const bounded = messages
            .map((message) => {
              const text = message.text.slice(0, Math.min(4000, remaining));
              remaining -= text.length;
              if (text.length < message.text.length) truncated = true;
              return { id: message.id, role: message.role, text };
            })
            .filter((message) => message.text.length > 0);
          result.push({
            id: root.id === item.id ? root.id : ThreadId.make(item.id),
            title: item.parentThreadId === null ? root.title : "Child agent",
            parentThreadId: item.parentThreadId,
            messages: bounded,
          });
        }
      }
      return {
        threads: result,
        truncated,
        coverage:
          "Chat messages and child-agent chat only; commands, tool activity and files were not inspected. Missing tracking or unobserved changes cannot be inferred from this snapshot.",
      };
    }),
  });
});
export const layer = Layer.effect(MonitoringSnapshot, make);
