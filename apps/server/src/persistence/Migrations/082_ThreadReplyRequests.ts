import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A thread that sent `message_id` to `target_thread_id` and is owed its outcome.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_reply_requests (
      message_id TEXT PRIMARY KEY,
      sender_thread_id TEXT NOT NULL,
      target_thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS thread_reply_requests_pending_idx
    ON thread_reply_requests(target_thread_id, sender_thread_id)
    WHERE delivered_at IS NULL
  `;
});
