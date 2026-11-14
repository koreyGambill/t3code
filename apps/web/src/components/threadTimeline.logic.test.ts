import { ThreadId, type ThreadTimeline } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  availableZooms,
  layoutTimeline,
  subtreeRunSignal,
  summarizeTimeline,
} from "./threadTimeline.logic";

const MIN = 60_000;
const lane = (
  id: string,
  parent: number | null,
  depth: number,
  relation: ThreadTimeline["lanes"][number]["relation"] = "delegate",
) => ({ threadId: ThreadId.make(id), parent, depth, title: id, relation });
const run = (
  laneIndex: number,
  startMin: number,
  durationMin: number | null,
  extra: Partial<ThreadTimeline["runs"][number]> = {},
): ThreadTimeline["runs"][number] => ({
  lane: laneIndex,
  ordinal: 1,
  status: durationMin === null ? "running" : "completed",
  model: 0,
  startedAt: startMin * MIN,
  queuedMs: 0,
  durationMs: durationMin === null ? null : durationMin * MIN,
  ...extra,
});

const timeline = (
  lanes: ThreadTimeline["lanes"],
  runs: ThreadTimeline["runs"],
  totals: Partial<ThreadTimeline["totals"]> = {},
): ThreadTimeline => ({
  threadId: lanes[0]!.threadId,
  lanes,
  models: ["opus", "haiku"],
  runs,
  totals: {
    runs: runs.length,
    firstStartedAt: Math.min(...runs.map((entry) => entry.startedAt)),
    lastCompletedAt: Math.max(
      ...runs.flatMap((entry) =>
        entry.durationMs === null ? [] : [entry.startedAt + entry.durationMs],
      ),
    ),
    finishedMs: runs.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
    finishedMsByModel: [],
    ...totals,
  },
});

describe("layoutTimeline", () => {
  it("orders lanes depth-first with siblings by their subtree's first run and drops empty lanes", () => {
    const data = timeline(
      [
        lane("lead", null, 0, "self"),
        lane("late", 0, 1),
        lane("early-parent", 0, 1),
        lane("grandchild", 2, 2, "subagent"),
        lane("idle", 0, 1),
      ],
      [run(0, 0, 10), run(1, 20, 5), run(3, 5, 2)],
    );
    const layout = layoutTimeline(data, { now: 100 * MIN, windowMs: null });
    expect(layout.lanes.map((entry) => entry.threadId)).toEqual([
      "lead",
      "early-parent",
      "grandchild",
      "late",
    ]);
  });

  it("places bars on one axis, leaves gaps empty, extends open runs to now and shows queue delay", () => {
    const data = timeline(
      [lane("lead", null, 0, "self")],
      [run(0, 10, 10, { queuedMs: 10 * MIN }), run(0, 60, 20), run(0, 90, null)],
    );
    const layout = layoutTimeline(data, { now: 100 * MIN, windowMs: null });
    expect(layout.start).toBe(0);
    expect(layout.end).toBe(100 * MIN);
    expect(layout.lanes[0]?.bars).toEqual([
      {
        run: 0,
        status: "completed",
        open: false,
        left: 10,
        width: 10,
        queueLeft: 0,
        queueWidth: 10,
      },
      {
        run: 1,
        status: "completed",
        open: false,
        left: 60,
        width: 20,
        queueLeft: 60,
        queueWidth: 0,
      },
      { run: 2, status: "running", open: true, left: 90, width: 10, queueLeft: 90, queueWidth: 0 },
    ]);
  });

  it("draws a run that opened after the minute tick once the answer that carried it is the clock", () => {
    const minute = 100 * MIN;
    const data = timeline(
      [lane("lead", null, 0, "self")],
      [run(0, 0, 10), run(0, 100 + 20 / 60, null)],
    );
    const answeredAt = minute + 30_000;
    const bar = layoutTimeline(data, { now: Math.max(minute, answeredAt), windowMs: null }).lanes[0]
      ?.bars[1];
    expect(bar?.open).toBe(true);
    expect(bar?.left).toBeLessThan(100);
    expect(bar?.width).toBeGreaterThan(0);
  });

  it("clips to the zoom window and drops lanes with nothing inside it", () => {
    const data = timeline(
      [lane("lead", null, 0, "self"), lane("old", 0, 1), lane("recent", 0, 1)],
      [run(1, 0, 10), run(0, 0, 100), run(2, 80, 20)],
    );
    const layout = layoutTimeline(data, { now: 100 * MIN, windowMs: 40 * MIN });
    expect(layout.start).toBe(60 * MIN);
    expect(layout.lanes.map((entry) => entry.threadId)).toEqual(["lead", "recent"]);
    expect(layout.lanes[0]?.bars[0]).toMatchObject({ left: 0, width: 100 });
    expect(layout.lanes[1]?.bars[0]).toMatchObject({ left: 50, width: 50 });
    const later = layoutTimeline(data, { now: 120 * MIN, windowMs: 40 * MIN });
    expect([later.start, later.end]).toEqual([80 * MIN, 120 * MIN]);
  });

  it("keeps the most recently active lanes past the cap, with the lead always shown", () => {
    const lanes = [lane("lead", null, 0, "self"), ...[1, 2, 3, 4].map((n) => lane(`c${n}`, 0, 1))];
    const data = timeline(lanes, [run(1, 0, 1), run(2, 10, 1), run(3, 20, 1), run(4, 30, 1)]);
    const layout = layoutTimeline(data, { now: 40 * MIN, windowMs: null, laneLimit: 3 });
    expect(layout.lanes.map((entry) => entry.threadId)).toEqual(["lead", "c3", "c4"]);
    expect(layout.hiddenLanes).toBe(2);

    const nested = timeline(
      [
        lane("lead", null, 0, "self"),
        lane("parent", 0, 1),
        lane("child", 1, 2),
        lane("busy", 0, 1),
      ],
      [run(1, 0, 1), run(2, 30, 1), run(3, 20, 1)],
    );
    expect(
      layoutTimeline(nested, { now: 40 * MIN, windowMs: null, laneLimit: 3 }).lanes.map(
        (entry) => entry.threadId,
      ),
    ).toEqual(["lead", "parent", "child"]);
  });

  it("summarises from server totals and adds open runs on the client clock", () => {
    const data = timeline(
      [lane("lead", null, 0, "self"), lane("child", 0, 1)],
      [run(0, 0, 10), run(1, 40, null, { model: 1 })],
      {
        runs: 12,
        firstStartedAt: -100 * MIN,
        lastCompletedAt: 10 * MIN,
        finishedMs: 70 * MIN,
        finishedMsByModel: [
          { model: "opus", ms: 60 * MIN },
          { model: "haiku", ms: 10 * MIN },
        ],
      },
    );
    expect(layoutTimeline(data, { now: 100 * MIN, windowMs: null }).omittedRuns).toBe(10);
    expect(summarizeTimeline(data, 100 * MIN)).toEqual({
      wallMs: 200 * MIN,
      agentMs: 130 * MIN,
      runs: 12,
      models: [
        { model: "haiku", ms: 70 * MIN },
        { model: "opus", ms: 60 * MIN },
      ],
    });
  });
});

describe("availableZooms", () => {
  it("offers only windows narrower than the whole span", () => {
    expect(availableZooms(3 * 3_600_000).map((zoom) => zoom.label)).toEqual(["Last hour"]);
    expect(availableZooms(30 * MIN)).toEqual([]);
  });
});

describe("subtreeRunSignal", () => {
  it("changes when a subtree run is requested or starts, not for other threads", () => {
    const shell = (
      id: string,
      parent: string | null,
      latest: string | null,
      activity: string | null = null,
    ) => ({
      id,
      lineage: { parentThreadId: parent },
      latestRunId: latest,
      activeRunId: null,
      activityRunStatus: activity,
    });
    const base = [
      shell("lead", null, "r1"),
      shell("child", "lead", "r1"),
      shell("other", null, "r1"),
    ];
    const signal = subtreeRunSignal("lead", base);
    expect(subtreeRunSignal("lead", [...base.slice(0, 2), shell("other", null, "r2")])).toBe(
      signal,
    );
    expect(subtreeRunSignal("lead", [base[0]!, shell("child", "lead", "r2"), base[2]!])).not.toBe(
      signal,
    );
    const starting = [shell("lead", null, "r2", "starting"), ...base.slice(1)];
    expect(
      subtreeRunSignal("lead", [shell("lead", null, "r2", "running"), ...base.slice(1)]),
    ).not.toBe(subtreeRunSignal("lead", starting));
  });
});
