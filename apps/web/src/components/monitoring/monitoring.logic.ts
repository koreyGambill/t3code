import type { MonitoringFinding } from "@t3tools/contracts";

export function visibleMonitoringFindings<
  A extends Pick<MonitoringFinding, "disposition" | "snoozedUntil">,
>(findings: ReadonlyArray<A>, now: number) {
  return findings.filter(
    (finding) =>
      finding.disposition === "open" &&
      (finding.snoozedUntil === null || Date.parse(finding.snoozedUntil) <= now),
  );
}
