import { expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  RunId,
  TurnItemId,
  type ThreadLoadEvent,
  type ThreadUsagePoint,
} from "@t3tools/contracts";
import { filterLoadEvents, reportedUsageTotals, usageSegments } from "./insightDisplay";
const point = (overrides: Partial<ThreadUsagePoint> = {}): ThreadUsagePoint => ({
  runId: RunId.make("run"),
  turnId: "turn",
  ordinal: 1,
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  at: "2026-11-06T00:00:00Z",
  status: "complete",
  localCommand: false,
  hasSubagents: false,
  inputTokens: 1000,
  outputTokens: 200,
  cachedInputTokens: 700,
  cacheCreationTokens: 100,
  reasoningTokens: 50,
  otherInputTokens: null,
  otherOutputTokens: null,
  ...overrides,
});
it("sums provider totals once while retaining incomplete usage and bounded subset bars", () => {
  expect(reportedUsageTotals([point()])).toMatchObject({
    input: 1000,
    output: 200,
    complete: true,
  });
  expect(
    reportedUsageTotals([
      point(),
      point({ turnId: "missing", inputTokens: null, outputTokens: null, status: "unavailable" }),
    ]),
  ).toMatchObject({ input: 1000, output: 200, complete: false, measuredTurns: 1 });
  expect(reportedUsageTotals([]).complete).toBe(false);
  expect(
    reportedUsageTotals([point(), point({ localCommand: true, inputTokens: 5000 })]),
  ).toMatchObject({ input: 1000, output: 200 });
  expect(reportedUsageTotals([point({ inputTokens: null, status: "partial" })])).toMatchObject({
    input: null,
    output: 200,
    complete: false,
  });
  expect(usageSegments(100, 120, 200)).toEqual({ totalWidth: 0.5, subsetWidth: 0.5 });
  expect(usageSegments(null, 120, 200)).toEqual({ totalWidth: 0, subsetWidth: 0 });
});
it("searches paths, tools and evidence while combining type and evidence filters", () => {
  const events: ThreadLoadEvent[] = [
    {
      itemId: TurnItemId.make("file"),
      runId: RunId.make("run"),
      at: "2026-11-06T00:00:00Z",
      kind: "file",
      label: "Read config",
      paths: ["/work/settings.json"],
      toolName: "read_file",
      evidence: "reported",
      status: "completed",
      outputBytes: 200,
      estimatedOutputTokens: 50,
    },
    {
      itemId: TurnItemId.make("skill"),
      runId: RunId.make("run"),
      at: "2026-11-06T00:01:00Z",
      kind: "skill",
      label: "Read skill",
      paths: ["/work/skills/review/SKILL.md"],
      toolName: "exec",
      evidence: "inferred",
      status: "failed",
      outputBytes: null,
      estimatedOutputTokens: null,
    },
  ];
  expect(
    filterLoadEvents(events, "SKILL.md inferred", "", "").map((event) => event.itemId),
  ).toEqual(["skill"]);
  expect(filterLoadEvents(events, "read_file settings", "file", "reported")).toHaveLength(1);
  expect(filterLoadEvents(events, "", "skill", "reported")).toHaveLength(0);
});
