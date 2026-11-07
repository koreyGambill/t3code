import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE orchestration_v2_projection_development_environment_usage (
      thread_id TEXT NOT NULL,
      xwing_environment_id TEXT NOT NULL,
      repository_source TEXT NOT NULL,
      checkout_path TEXT NOT NULL,
      environment_number INTEGER,
      environment_name TEXT NOT NULL,
      first_selected_at TEXT NOT NULL,
      last_selected_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, xwing_environment_id, repository_source)
    )
  `;
  yield* sql`
    CREATE INDEX orchestration_v2_projection_development_environment_usage_environment_idx
    ON orchestration_v2_projection_development_environment_usage(xwing_environment_id)
  `;
  yield* sql`
    CREATE INDEX orchestration_v2_projection_development_environment_usage_checkout_idx
    ON orchestration_v2_projection_development_environment_usage(checkout_path)
  `;
});
