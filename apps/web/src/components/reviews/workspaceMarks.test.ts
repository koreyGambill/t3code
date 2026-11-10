import { expect, it } from "vite-plus/test";
import { collectWorkspaceMarks } from "@t3tools/shared/workspaceMarks";

it("keeps the first URL occurrence, excludes prose punctuation, and classifies host boundaries", () => {
  const marks = collectWorkspaceMarks([
    {
      createdAt: "2026-11-06T04:15:00Z",
      text: "[Spec](https://notion.so/spec) and https://team.slack.com/archives/123. Also https://notslack.com/x",
    },
    {
      createdAt: "2026-11-07T04:15:00Z",
      text: "Again https://notion.so/spec and https://github.com/org/repo/issues/1",
    },
  ]);
  expect(marks.map(({ url, service, timestamp }) => ({ url, service, timestamp }))).toEqual([
    { url: "https://notion.so/spec", service: "Notion", timestamp: "2026-11-06T04:15:00Z" },
    {
      url: "https://team.slack.com/archives/123",
      service: "Slack",
      timestamp: "2026-11-06T04:15:00Z",
    },
    { url: "https://notslack.com/x", service: "Other", timestamp: "2026-11-06T04:15:00Z" },
    {
      url: "https://github.com/org/repo/issues/1",
      service: "GitHub",
      timestamp: "2026-11-07T04:15:00Z",
    },
  ]);
  expect(
    collectWorkspaceMarks([
      { createdAt: "2026-11-07T04:15:00Z", text: "https://notion.so/spec" },
      { createdAt: "2026-11-06T04:15:00Z", text: "https://notion.so/spec" },
    ])[0]?.timestamp,
  ).toBe("2026-11-06T04:15:00Z");
});
