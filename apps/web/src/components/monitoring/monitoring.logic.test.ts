import { describe, expect, it } from "vite-plus/test";
import type { MonitoringFinding } from "@t3tools/contracts";

import { visibleMonitoringFindings } from "./monitoring.logic";

describe("visibleMonitoringFindings", () => {
  it("keeps unread alerts hidden until snooze expires and excludes closed dispositions", () => {
    const at = "2026-11-07T12:00:00.000Z";
    const findings: ReadonlyArray<
      Pick<MonitoringFinding, "disposition" | "snoozedUntil"> & { id: string }
    > = [
      { id: "open", disposition: "open", snoozedUntil: null },
      { id: "boundary", disposition: "open", snoozedUntil: at },
      { id: "future", disposition: "open", snoozedUntil: "2026-11-07T13:00:00.000Z" },
      { id: "dismissed", disposition: "dismissed", snoozedUntil: null },
      { id: "resolved", disposition: "resolved", snoozedUntil: null },
      { id: "acknowledged", disposition: "acknowledged", snoozedUntil: null },
    ];
    expect(
      visibleMonitoringFindings(findings, Date.parse(at)).map((finding) => finding.id),
    ).toEqual(["open", "boundary"]);
    expect(
      visibleMonitoringFindings(findings, Date.parse("2026-11-07T13:00:00.000Z")).map(
        (finding) => finding.id,
      ),
    ).toEqual(["open", "boundary", "future"]);
  });
});
