import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // One row per (event task, thread or status source): the pending coalesced fire and the cooldown anchor.
  yield* sql`CREATE TABLE scheduled_task_event_subjects (
    task_id TEXT NOT NULL REFERENCES scheduled_tasks(task_id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    due_at TEXT,
    event_key TEXT,
    event_json TEXT,
    event_count INTEGER NOT NULL DEFAULT 0,
    last_event_key TEXT,
    last_fired_at TEXT,
    owned INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_id, subject)
  )`;
  yield* sql`CREATE INDEX idx_scheduled_task_event_subjects_due
    ON scheduled_task_event_subjects(task_id, due_at) WHERE due_at IS NOT NULL`;
});
