import type { EnvironmentId, ReviewSummary } from "@t3tools/contracts";

export function createReviewReminderGate(environmentId: EnvironmentId, seen: Set<string>) {
  const presented = new Map<string, () => void>();
  const keyFor = (review: ReviewSummary) => `${environmentId}:${review.id}:${review.remindAt}`;
  const close = (key: string) => {
    presented.get(key)?.();
    presented.delete(key);
  };
  return {
    sync(
      due: ReadonlyArray<ReviewSummary>,
      shownReviewId: string | undefined,
      present: (review: ReviewSummary) => (() => void) | undefined,
    ) {
      const current = new Set(due.filter((review) => review.remindAt !== null).map(keyFor));
      for (const key of presented.keys()) if (!current.has(key)) close(key);
      for (const review of due) {
        if (review.remindAt === null) continue;
        const key = keyFor(review);
        if (review.id === shownReviewId) {
          seen.add(key);
          close(key);
        } else if (!seen.has(key)) {
          const dismiss = present(review);
          if (dismiss === undefined) continue;
          seen.add(key);
          presented.set(key, dismiss);
        }
      }
    },
    dispose() {
      for (const key of presented.keys()) close(key);
    },
  };
}
