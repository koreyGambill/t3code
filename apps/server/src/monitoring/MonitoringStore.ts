import {
  MonitoringError,
  MonitoringFinding,
  MonitoringProfile,
  MonitoringRun,
  type MonitoringFindingId,
  type MonitoringListResult,
  type MonitoringProfileId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const decodeProfile = Schema.decodeEffect(Schema.fromJsonString(MonitoringProfile));
const encodeProfile = Schema.encodeEffect(Schema.fromJsonString(MonitoringProfile));
const decodeFinding = Schema.decodeEffect(Schema.fromJsonString(MonitoringFinding));
const encodeFinding = Schema.encodeEffect(Schema.fromJsonString(MonitoringFinding));
const decodeRun = Schema.decodeEffect(Schema.fromJsonString(MonitoringRun));
const encodeRun = Schema.encodeEffect(Schema.fromJsonString(MonitoringRun));
const decodeProfiles = Schema.decodeEffect(Schema.Array(Schema.fromJsonString(MonitoringProfile)));
const decodeFindings = Schema.decodeEffect(Schema.Array(Schema.fromJsonString(MonitoringFinding)));
const decodeRuns = Schema.decodeEffect(Schema.Array(Schema.fromJsonString(MonitoringRun)));

export class MonitoringStore extends Context.Service<
  MonitoringStore,
  {
    readonly status: () => Effect.Effect<{ readonly unreadCount: number }, MonitoringError>;
    readonly listProfiles: () => Effect.Effect<ReadonlyArray<MonitoringProfile>, MonitoringError>;
    readonly list: () => Effect.Effect<MonitoringListResult, MonitoringError>;
    readonly getRun: (id: string) => Effect.Effect<MonitoringRun | null, MonitoringError>;
    readonly getProfile: (
      id: MonitoringProfileId,
    ) => Effect.Effect<MonitoringProfile | null, MonitoringError>;
    readonly getFinding: (
      id: MonitoringFindingId,
    ) => Effect.Effect<MonitoringFinding | null, MonitoringError>;
    readonly saveProfile: (profile: MonitoringProfile) => Effect.Effect<void, MonitoringError>;
    readonly saveFinding: (finding: MonitoringFinding) => Effect.Effect<void, MonitoringError>;
    readonly saveRun: (run: MonitoringRun) => Effect.Effect<void, MonitoringError>;
  }
>()("t3/monitoring/MonitoringStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listProfiles = Effect.fn("MonitoringStore.listProfiles")(function* () {
    return yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM monitoring_profiles ORDER BY id`.pipe(
      NodeSqliteClient.readOnly,
      Effect.flatMap((rows) => decodeProfiles(rows.map((row) => row.payload_json))),
      Effect.mapError((cause) => new MonitoringError({ operation: "read profiles", cause })),
    );
  });
  const list = Effect.fn("MonitoringStore.list")(function* () {
    const [profiles, findings, runs] = yield* Effect.all([
      listProfiles(),
      sql<{
        payload_json: string;
      }>`SELECT payload_json FROM monitoring_findings ORDER BY updated_at DESC LIMIT 500`.pipe(
        NodeSqliteClient.readOnly,
        Effect.flatMap((rows) => decodeFindings(rows.map((row) => row.payload_json))),
      ),
      sql<{
        payload_json: string;
      }>`SELECT payload_json FROM monitoring_runs ORDER BY started_at DESC LIMIT 100`.pipe(
        NodeSqliteClient.readOnly,
        Effect.flatMap((rows) => decodeRuns(rows.map((row) => row.payload_json))),
      ),
    ]).pipe(Effect.mapError((cause) => new MonitoringError({ operation: "read", cause })));
    return { profiles, findings, runs };
  });
  return MonitoringStore.of({
    list,
    listProfiles,
    status: Effect.fn("MonitoringStore.status")(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      const rows = yield* sql<{
        unreadCount: number;
      }>`SELECT count(*) AS unreadCount FROM monitoring_findings WHERE json_extract(payload_json, '$.disposition') = 'open' AND json_extract(payload_json, '$.readAt') IS NULL AND (json_extract(payload_json, '$.snoozedUntil') IS NULL OR julianday(json_extract(payload_json, '$.snoozedUntil')) <= julianday(${now}))`.pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError((cause) => new MonitoringError({ operation: "read unread count", cause })),
      );
      return { unreadCount: rows[0]?.unreadCount ?? 0 };
    }),
    getRun: Effect.fn("MonitoringStore.getRun")(function* (id) {
      const rows = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM monitoring_runs WHERE id = ${id}`.pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError((cause) => new MonitoringError({ operation: "read run", cause })),
      );
      return rows[0] === undefined
        ? null
        : yield* decodeRun(rows[0].payload_json).pipe(
            Effect.mapError((cause) => new MonitoringError({ operation: "decode run", cause })),
          );
    }),
    getProfile: Effect.fn("MonitoringStore.getProfile")(function* (id) {
      const rows = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM monitoring_profiles WHERE id = ${id}`.pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError((cause) => new MonitoringError({ operation: "read profile", cause })),
      );
      return rows[0] === undefined
        ? null
        : yield* decodeProfile(rows[0].payload_json).pipe(
            Effect.mapError((cause) => new MonitoringError({ operation: "decode profile", cause })),
          );
    }),
    getFinding: Effect.fn("MonitoringStore.getFinding")(function* (id) {
      const rows = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM monitoring_findings WHERE id = ${id}`.pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError((cause) => new MonitoringError({ operation: "read finding", cause })),
      );
      return rows[0] === undefined
        ? null
        : yield* decodeFinding(rows[0].payload_json).pipe(
            Effect.mapError((cause) => new MonitoringError({ operation: "decode finding", cause })),
          );
    }),
    saveProfile: Effect.fn("MonitoringStore.saveProfile")(function (profile) {
      return encodeProfile(profile).pipe(
        Effect.flatMap(
          (json) =>
            sql`INSERT INTO monitoring_profiles (id, task_id, payload_json) VALUES (${profile.id}, ${profile.scheduledTaskId}, ${json}) ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, payload_json=excluded.payload_json`,
        ),
        Effect.asVoid,
        Effect.mapError((cause) => new MonitoringError({ operation: "save profile", cause })),
      );
    }),
    saveFinding: Effect.fn("MonitoringStore.saveFinding")(function (finding) {
      return encodeFinding(finding).pipe(
        Effect.flatMap(
          (json) =>
            sql`INSERT INTO monitoring_findings (id, profile_id, thread_id, updated_at, payload_json) VALUES (${finding.id}, ${finding.profileId}, ${finding.threadId}, ${finding.updatedAt}, ${json}) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
        ),
        Effect.asVoid,
        Effect.mapError((cause) => new MonitoringError({ operation: "save finding", cause })),
      );
    }),
    saveRun: Effect.fn("MonitoringStore.saveRun")(function (run) {
      return encodeRun(run).pipe(
        Effect.flatMap(
          (json) =>
            sql`INSERT INTO monitoring_runs (id, profile_id, started_at, payload_json) VALUES (${run.id}, ${run.profileId}, ${run.startedAt}, ${json}) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json`,
        ),
        Effect.asVoid,
        Effect.mapError((cause) => new MonitoringError({ operation: "save run", cause })),
      );
    }),
  });
});
export const layer = Layer.effect(MonitoringStore, make);
