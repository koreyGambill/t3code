import type { StatusSource, StatusState } from "@t3tools/contracts";

const priority = { ok: 0, unknown: 1, warn: 2, fail: 3 } satisfies Record<StatusState, number>;

export function summarizeStatusSources(
  sources: ReadonlyArray<{ latest: Pick<StatusSource["latest"], "state"> }>,
  unavailable = false,
): StatusState | null {
  return sources.reduce<StatusState | null>(
    (worst, { latest: { state } }) =>
      worst === null || priority[state] > priority[worst] ? state : worst,
    unavailable ? "unknown" : null,
  );
}
