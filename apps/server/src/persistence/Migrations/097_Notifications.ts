import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    source_json TEXT NOT NULL,
    thread_id TEXT,
    project_id TEXT,
    read_at TEXT,
    dismissed_at TEXT,
    snoozed_until TEXT,
    verification_json TEXT,
    dedupe_key TEXT NOT NULL,
    repeat_count INTEGER NOT NULL DEFAULT 0
  )`;
  yield* sql`CREATE INDEX idx_notifications_inbox
    ON notifications(dismissed_at, snoozed_until, created_at)`;
  yield* sql`CREATE INDEX idx_notifications_dedupe ON notifications(dedupe_key, created_at)`;
});
