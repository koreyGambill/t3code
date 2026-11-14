import type {
  OrchestrationV2RunStatus,
  ThreadTimeline,
  ThreadTimelineRelation,
} from "@t3tools/contracts";

const TIMELINE_LANE_LIMIT = 150;
const HOUR = 3_600_000;
const TIMELINE_ZOOMS = [
  { label: "Last 7 days", ms: 168 * HOUR },
  { label: "Last 24 hours", ms: 24 * HOUR },
  { label: "Last 6 hours", ms: 6 * HOUR },
  { label: "Last hour", ms: HOUR },
] as const;

export interface TimelineBar {
  readonly run: number;
  readonly status: OrchestrationV2RunStatus;
  readonly open: boolean;
  /** Percentages of the window. */
  readonly left: number;
  readonly width: number;
  readonly queueLeft: number;
  readonly queueWidth: number;
}

export interface TimelineLaneLayout {
  readonly lane: number;
  readonly threadId: string;
  readonly title: string;
  readonly depth: number;
  readonly relation: ThreadTimelineRelation;
  readonly bars: ReadonlyArray<TimelineBar>;
}

export interface TimelineSummary {
  readonly wallMs: number;
  readonly agentMs: number;
  readonly runs: number;
  readonly models: ReadonlyArray<{ readonly model: string; readonly ms: number }>;
}

export interface TimelineLayout {
  readonly start: number;
  readonly end: number;
  readonly spanMs: number;
  readonly lanes: ReadonlyArray<TimelineLaneLayout>;
  readonly hiddenLanes: number;
  readonly omittedRuns: number;
}

export const runEnd = (run: ThreadTimeline["runs"][number], now: number) =>
  run.durationMs === null ? Math.max(now, run.startedAt) : run.startedAt + run.durationMs;

/** Depth-first from the requested thread; siblings by the earliest run in their subtree. */
function orderLanes(timeline: ThreadTimeline): number[] {
  const firstStart = timeline.lanes.map(() => Number.POSITIVE_INFINITY);
  for (const run of timeline.runs) {
    let lane: number | null = run.lane;
    while (lane !== null && run.startedAt < (firstStart[lane] ?? 0)) {
      firstStart[lane] = run.startedAt;
      lane = timeline.lanes[lane]?.parent ?? null;
    }
  }
  const children = new Map<number | null, number[]>();
  timeline.lanes.forEach((lane, index) => {
    const parent = lane.depth === 0 ? null : lane.parent;
    const siblings = children.get(parent);
    if (siblings) siblings.push(index);
    else children.set(parent, [index]);
  });
  const ordered: number[] = [];
  const visit = (parent: number | null) => {
    const siblings = (children.get(parent) ?? []).toSorted(
      (a, b) => (firstStart[a] ?? 0) - (firstStart[b] ?? 0) || a - b,
    );
    for (const lane of siblings) {
      ordered.push(lane);
      visit(lane);
    }
  };
  visit(null);
  return ordered;
}

export function summarizeTimeline(timeline: ThreadTimeline, now: number): TimelineSummary {
  const { totals } = timeline;
  const byModel = new Map(totals.finishedMsByModel.map(({ model, ms }) => [model, ms]));
  let agentMs = totals.finishedMs;
  let lastEnd = totals.lastCompletedAt ?? totals.firstStartedAt ?? now;
  for (const run of timeline.runs) {
    if (run.durationMs !== null) continue;
    const ms = runEnd(run, now) - run.startedAt;
    const model = timeline.models[run.model] ?? "";
    agentMs += ms;
    byModel.set(model, (byModel.get(model) ?? 0) + ms);
    lastEnd = Math.max(lastEnd, now);
  }
  return {
    wallMs: totals.firstStartedAt === null ? 0 : lastEnd - totals.firstStartedAt,
    agentMs,
    runs: totals.runs,
    models: [...byModel].map(([model, ms]) => ({ model, ms })).toSorted((a, b) => b.ms - a.ms),
  };
}

export function layoutTimeline(
  timeline: ThreadTimeline,
  options: { readonly now: number; readonly windowMs: number | null; readonly laneLimit?: number },
): TimelineLayout {
  const { now } = options;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const run of timeline.runs) {
    first = Math.min(first, run.startedAt - run.queuedMs);
    last = Math.max(last, runEnd(run, now));
  }
  if (!Number.isFinite(first)) first = last = now;
  const end = last;
  const start = options.windowMs === null ? first : Math.max(first, end - options.windowMs);
  const spanMs = Math.max(end - start, 1);
  const pct = (time: number) => ((Math.min(Math.max(time, start), end) - start) / spanMs) * 100;

  const bars = new Map<number, TimelineBar[]>();
  const lastActive = new Map<number, number>();
  timeline.runs.forEach((run, index) => {
    const finish = runEnd(run, now);
    if (finish < start) return;
    const requested = run.startedAt - run.queuedMs;
    const left = pct(run.startedAt);
    const queueLeft = pct(requested);
    const bar: TimelineBar = {
      run: index,
      status: run.status,
      open: run.durationMs === null,
      left,
      width: pct(finish) - left,
      queueLeft,
      queueWidth: left - queueLeft,
    };
    const lane = bars.get(run.lane);
    if (lane) lane.push(bar);
    else bars.set(run.lane, [bar]);
    lastActive.set(run.lane, Math.max(lastActive.get(run.lane) ?? 0, finish));
  });

  const withBars = new Set<number>();
  for (const barLane of bars.keys()) {
    let lane: number | null = barLane;
    while (lane !== null && !withBars.has(lane)) {
      withBars.add(lane);
      lane = timeline.lanes[lane]?.parent ?? null;
    }
  }
  const shown = orderLanes(timeline).filter(
    (lane) => withBars.has(lane) || timeline.lanes[lane]?.depth === 0,
  );
  const limit = options.laneLimit ?? TIMELINE_LANE_LIMIT;
  const kept =
    shown.length <= limit
      ? new Set(shown)
      : new Set(
          shown
            .filter((lane) => timeline.lanes[lane]?.depth !== 0)
            .toSorted((a, b) => (lastActive.get(b) ?? 0) - (lastActive.get(a) ?? 0))
            .slice(0, limit - 1)
            .concat(shown.filter((lane) => timeline.lanes[lane]?.depth === 0)),
        );
  const lanes = shown.flatMap((index): TimelineLaneLayout[] => {
    const lane = timeline.lanes[index];
    if (!lane || !kept.has(index)) return [];
    return [
      {
        lane: index,
        threadId: lane.threadId,
        title: lane.title,
        depth: lane.depth,
        relation: lane.relation,
        bars: bars.get(index) ?? [],
      },
    ];
  });
  return {
    start,
    end,
    spanMs: end - start,
    lanes,
    hiddenLanes: shown.length - lanes.length,
    omittedRuns: timeline.totals.runs - timeline.runs.length,
  };
}

/** Zooms narrower than the whole timeline; none when it already fits the smallest. */
export function availableZooms(wholeSpanMs: number) {
  return TIMELINE_ZOOMS.filter((zoom) => zoom.ms < wholeSpanMs);
}

/**
 * Changes when a run is requested, starts or ends anywhere in the loaded subtree, so the timeline
 * refetches then rather than on every shell update.
 */
export function subtreeRunSignal(
  threadId: string,
  shells: ReadonlyArray<{
    readonly id: string;
    readonly lineage: { readonly parentThreadId: string | null };
    readonly latestRunId: string | null;
    readonly activeRunId: string | null;
    readonly activityRunStatus?: string | null | undefined;
  }>,
): string {
  const children = new Map<string, Array<(typeof shells)[number]>>();
  let self: (typeof shells)[number] | undefined;
  for (const shell of shells) {
    if (shell.id === threadId) self = shell;
    const parent = shell.lineage.parentThreadId;
    if (parent === null) continue;
    const siblings = children.get(parent);
    if (siblings) siblings.push(shell);
    else children.set(parent, [shell]);
  }
  const parts: string[] = [];
  const pending = self ? [self] : [];
  for (let shell = pending.pop(); shell; shell = pending.pop()) {
    parts.push(
      `${shell.id}:${shell.latestRunId}:${shell.activeRunId}:${shell.activityRunStatus ?? ""}`,
    );
    pending.push(...(children.get(shell.id) ?? []));
  }
  return parts.toSorted().join("|");
}
