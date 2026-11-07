import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE monitoring_profiles (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL)`;
  yield* sql`CREATE TABLE monitoring_findings (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, thread_id TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL)`;
  yield* sql`CREATE INDEX monitoring_findings_profile_idx ON monitoring_findings(profile_id, updated_at)`;
  yield* sql`CREATE TABLE monitoring_runs (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, started_at TEXT NOT NULL, payload_json TEXT NOT NULL)`;
  yield* sql`CREATE INDEX monitoring_runs_profile_idx ON monitoring_runs(profile_id, started_at)`;
});
