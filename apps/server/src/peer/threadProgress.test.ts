import { RunId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";

import { summarizeThreadProgress } from "./threadProgress.ts";

it("holds a completed reply while background work or requests remain", () => {
  const run = { id: RunId.make("run:remote"), status: "completed" as const };
  const reply = { text: "x".repeat(700), runId: run.id };
  const base = {
    run,
    reply,
    continuationPending: false,
    pendingBackgroundWorkCount: 2,
    pendingRequestCount: 0,
    hasPendingQuestion: false,
  };
  const waiting = summarizeThreadProgress(base);
  expect(waiting).toMatchObject({
    status: "waiting",
    pendingBackgroundWorkCount: 2,
    lastAssistantReply: { text: "x".repeat(500), truncated: true, isFinal: false },
  });
  expect(
    summarizeThreadProgress({ ...base, pendingRequestCount: 1, hasPendingQuestion: true }).status,
  ).toBe("question");
  expect(summarizeThreadProgress({ ...base, continuationPending: true }).status).toBe("working");
  expect(summarizeThreadProgress({ ...base, pendingBackgroundWorkCount: 0 })).toMatchObject({
    status: "done",
    lastAssistantReply: { isFinal: true },
  });
  for (const status of ["queued", "running"] as const) {
    expect(
      summarizeThreadProgress({ ...base, run: { ...run, status }, pendingBackgroundWorkCount: 0 }),
    ).toMatchObject({ status: "working", lastAssistantReply: { isFinal: false } });
  }
});
