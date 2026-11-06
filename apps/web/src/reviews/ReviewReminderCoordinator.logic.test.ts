import { EnvironmentId, ReviewId, ThreadId, type ReviewSummary } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { createReviewReminderGate } from "./ReviewReminderCoordinator.logic";

const environmentId = EnvironmentId.make("reviews-a");
const review: ReviewSummary = {
  id: ReviewId.make("00000000-0000-4000-8000-000000000001"),
  threadId: ThreadId.make("review-thread"),
  title: "Rollout",
  revision: 1,
  lastSubmittedRevision: null,
  remindAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T09:00:00.000Z",
};

it("catches up due reminders once, closes cancelled or postponed notices, and announces the new time", () => {
  const seen = new Set<string>();
  const gate = createReviewReminderGate(environmentId, seen);
  const close = vi.fn();
  const present = vi.fn(() => close);
  gate.sync([review], undefined, present);
  gate.sync([{ ...review, revision: 2 }], undefined, present);
  expect(present).toHaveBeenCalledTimes(1);
  gate.sync([], undefined, present);
  expect(close).toHaveBeenCalledTimes(1);
  const postponed = { ...review, remindAt: "2026-01-02T10:00:00.000Z" };
  gate.sync([postponed], undefined, present);
  expect(present).toHaveBeenCalledTimes(2);
  gate.sync([{ ...postponed, remindAt: null }], undefined, present);
  expect(close).toHaveBeenCalledTimes(2);
});

it("acknowledges opening the review and keeps environments separate", () => {
  const seen = new Set<string>();
  const gate = createReviewReminderGate(environmentId, seen);
  const present = vi.fn(() => vi.fn());
  gate.sync([review], review.id, present);
  gate.sync([review], undefined, present);
  expect(present).not.toHaveBeenCalled();
  createReviewReminderGate(EnvironmentId.make("reviews-b"), seen).sync(
    [review],
    undefined,
    present,
  );
  expect(present).toHaveBeenCalledTimes(1);
});

it("keeps disabled notifications eligible and catches up again after an app restart", () => {
  const present = vi.fn(() => vi.fn());
  const gate = createReviewReminderGate(environmentId, new Set());
  gate.sync([review], undefined, () => undefined);
  gate.sync([review], undefined, present);
  gate.dispose();
  createReviewReminderGate(environmentId, new Set()).sync([review], undefined, present);
  expect(present).toHaveBeenCalledTimes(2);
});
