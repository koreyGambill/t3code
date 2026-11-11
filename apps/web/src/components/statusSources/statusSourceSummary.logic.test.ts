import type { StatusState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { summarizeStatusSources } from "./statusSourceSummary.logic";

describe("summarizeStatusSources", () => {
  it.each<{ states: StatusState[]; expected: StatusState | null }>([
    { states: [], expected: null },
    { states: ["ok", "ok"], expected: "ok" },
    { states: ["ok", "unknown"], expected: "unknown" },
    { states: ["warn", "unknown", "ok"], expected: "warn" },
    { states: ["ok", "fail", "warn", "unknown"], expected: "fail" },
    { states: ["fail", "ok"], expected: "fail" },
  ])("summarizes $states as $expected", ({ states, expected }) => {
    expect(summarizeStatusSources(states.map((state) => ({ latest: { state } })))).toBe(expected);
  });
});
