import { assert, it } from "@effect/vitest";
import { ScheduledTaskId, ScheduledTaskRunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as RunHistory from "./RunHistory.ts";

it.effect("keeps the newest runs per task and pages through them newest first", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = "2026-09-09T12:00:00.000Z";
    for (const id of ["task:a", "task:b"]) {
      yield* sql`INSERT INTO scheduled_tasks ${sql.insert({
        task_id: id,
        title: "task",
        prompt: "Run task",
        enabled: 1,
        schedule_json: '{"type":"interval","everyMs":60000}',
        project_id: "project:test",
        thread_id: null,
        workspace_strategy_json: '{"type":"root"}',
        model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
        runtime_mode: "full-access",
        interaction_mode: "default",
        created_by: "user",
        creation_source: "web",
        created_at: now,
        updated_at: now,
        next_run_at: null,
        last_run_at: null,
        last_run_status: "never",
        last_run_error: null,
        run_count: 0,
      })}`;
    }
    const taskId = ScheduledTaskId.make("task:a");
    const total = RunHistory.RUN_RETENTION_PER_TASK + 5;
    // Two runs share each start time, so the cursor must break ties.
    for (let index = 0; index < total; index++) {
      yield* RunHistory.startRun({
        id: ScheduledTaskRunId.make(`run:${index}`),
        taskId,
        startedAt: DateTime.formatIso(
          DateTime.makeUnsafe(Date.parse(now) + Math.floor(index / 2) * 1_000),
        ),
        trigger: { type: "schedule", summary: "On schedule" },
      });
    }
    yield* RunHistory.startRun({
      id: ScheduledTaskRunId.make("run:other-task"),
      taskId: ScheduledTaskId.make("task:b"),
      startedAt: now,
      trigger: { type: "manual", summary: "Run now" },
    });

    const kept = yield* sql<{ id: string }>`SELECT id FROM scheduled_task_runs
      WHERE task_id = ${taskId}`;
    assert.lengthOf(kept, RunHistory.RUN_RETENTION_PER_TASK);
    assert.isFalse(kept.some((row) => row.id === "run:4"));
    assert.isTrue(kept.some((row) => row.id === "run:5"));

    const seen: Array<string> = [];
    let before: ScheduledTaskRunId | undefined;
    let pages = 0;
    for (;;) {
      const page = yield* RunHistory.listRuns(taskId, before);
      pages++;
      seen.push(...page.runs.map((run) => run.id));
      if (!page.hasMore) break;
      before = page.runs.at(-1)?.id;
    }
    assert.equal(pages, Math.ceil(RunHistory.RUN_RETENTION_PER_TASK / RunHistory.RUNS_PAGE_SIZE));
    assert.lengthOf(seen, RunHistory.RUN_RETENTION_PER_TASK);
    assert.equal(seen[0], `run:${total - 1}`);
    assert.equal(seen.at(-1), "run:5");
    assert.equal(new Set(seen).size, seen.length);

    yield* RunHistory.finishRun(ScheduledTaskRunId.make(`run:${total - 1}`), {
      status: "quiet",
      endedAt: now,
      error: null,
      tokens: 12,
    });
    // A closed run keeps its first outcome.
    yield* RunHistory.finishRun(ScheduledTaskRunId.make(`run:${total - 1}`), {
      status: "failed",
      endedAt: now,
      error: "late",
    });
    const [newest] = (yield* RunHistory.listRuns(taskId, undefined)).runs;
    assert.deepInclude(newest, { status: "quiet", endedAt: now, error: null, tokens: 12 });
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
