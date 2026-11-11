import type { StatusState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { summarizeStatusSources } from "./statusSourceSummary.logic";

describe("summarizeStatusSources", () => {
  it.each<{ states: StatusState[]; unavailable?: boolean; expected: StatusState | null }>([
    { states: [], expected: null },
    { states: ["ok", "ok"], expected: "ok" },
    { states: ["ok", "unknown"], expected: "unknown" },
    { states: ["warn", "unknown", "ok"], expected: "warn" },
    { states: ["ok", "fail", "warn", "unknown"], expected: "fail" },
    { states: ["fail", "ok"], expected: "fail" },
    { states: [], unavailable: true, expected: "unknown" },
    { states: ["ok"], unavailable: true, expected: "unknown" },
    { states: ["warn"], unavailable: true, expected: "warn" },
    { states: ["fail"], unavailable: true, expected: "fail" },
  ])("summarizes $states as $expected", ({ states, unavailable, expected }) => {
    expect(
      summarizeStatusSources(
        states.map((state) => ({ latest: { state } })),
        unavailable,
      ),
    ).toBe(expected);
  });
});
