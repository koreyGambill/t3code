import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // One row per automation run, or per stretch of consecutive skipped check-ins (skip_count).
  // The service keeps each task's newest 200 runs that were not skipped.
  yield* sql`CREATE TABLE scheduled_task_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES scheduled_tasks(task_id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    trigger_json TEXT NOT NULL,
    thread_id TEXT,
    message_id TEXT,
    orchestration_run_id TEXT,
    cost_usd REAL,
    tokens INTEGER,
    other_tokens INTEGER,
    other_cost_usd_estimate REAL,
    skip_count INTEGER NOT NULL DEFAULT 0,
    subagent_count INTEGER NOT NULL DEFAULT 0,
    notification_ids_json TEXT NOT NULL DEFAULT '[]',
    escalation_json TEXT,
    error TEXT
  )`;
  yield* sql`CREATE INDEX idx_scheduled_task_runs_task_started
    ON scheduled_task_runs(task_id, started_at DESC)`;
  yield* sql`CREATE INDEX idx_scheduled_task_runs_orchestration_run
    ON scheduled_task_runs(orchestration_run_id) WHERE orchestration_run_id IS NOT NULL`;
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN last_run_ended_at TEXT`;
});
