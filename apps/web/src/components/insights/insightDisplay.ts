import type { ThreadLoadEvent, ThreadUsagePoint } from "@t3tools/contracts";

export function filterLoadEvents(
  events: ReadonlyArray<ThreadLoadEvent>,
  search: string,
  kind: string,
  evidence: string,
) {
  const terms = search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return events.filter((event) => {
    if (kind && event.kind !== kind) return false;
    if (evidence && event.evidence !== evidence) return false;
    const text = [
      event.label,
      ...event.paths,
      event.toolName,
      event.kind,
      event.evidence,
      event.status,
      event.at,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function reportedUsageTotals(allPoints: ReadonlyArray<ThreadUsagePoint>) {
  const points = allPoints.filter((point) => !point.localCommand);
  return {
    input: points.some((point) => point.inputTokens !== null)
      ? points.reduce((sum, point) => sum + (point.inputTokens ?? 0), 0)
      : null,
    output: points.some((point) => point.outputTokens !== null)
      ? points.reduce((sum, point) => sum + (point.outputTokens ?? 0), 0)
      : null,
    complete:
      points.length > 0 &&
      points.every(
        (point) =>
          point.status === "complete" && point.inputTokens !== null && point.outputTokens !== null,
      ),
    measuredTurns: points.filter(
      (point) => point.inputTokens !== null || point.outputTokens !== null,
    ).length,
  };
}

export function usageSegments(total: number | null, subset: number | null, max: number) {
  if (total === null || max <= 0) return { totalWidth: 0, subsetWidth: 0 };
  return {
    totalWidth: Math.max(0, total) / max,
    subsetWidth: Math.max(0, Math.min(total, subset ?? 0)) / max,
  };
}
