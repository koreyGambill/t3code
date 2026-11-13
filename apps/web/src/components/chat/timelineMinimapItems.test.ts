import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId, MessageId, type TurnOrigin } from "@t3tools/contracts";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";

import { deriveTimelineMinimapItems, resolveTimelineMinimapPreview } from "./timelineMinimapItems";

describe("deriveTimelineMinimapItems", () => {
  it("only marks human input, including explicit user origins", () => {
    const at = "2026-10-01T00:00:00Z";
    const origins: Array<TurnOrigin | undefined> = [
      undefined,
      { kind: "user" },
      {
        kind: "thread",
        threadId: ThreadId.make("peer"),
        environmentId: EnvironmentId.make("local"),
        title: "Peer",
        event: "message",
      },
      {
        kind: "subagent",
        threadId: ThreadId.make("child"),
        environmentId: EnvironmentId.make("local"),
        title: "Child",
        event: "completed",
      },
      { kind: "system", event: "monitor" },
    ];
    const rows = origins.map((origin, index) => ({
      kind: "message" as const,
      id: `input-${index}`,
      createdAt: at,
      showAssistantMeta: false,
      showAssistantCopyButton: false,
      assistantCopyStreaming: false,
      message: {
        id: MessageId.make(`input-${index}`),
        role: "user" as const,
        text: "Update",
        runId: null,
        streaming: false,
        createdAt: at,
        updatedAt: at,
        ...(origin ? { origin } : {}),
      },
    }));
    expect(
      deriveTimelineMinimapItems([
        ...rows,
        {
          ...rows[1]!,
          id: "system-as-user",
          message: { ...rows[1]!.message, createdBy: "system", creationSource: "server" },
        },
        {
          ...rows[1]!,
          id: "agent-as-user",
          message: { ...rows[1]!.message, createdBy: "agent", creationSource: "server" },
        },
        {
          ...rows[0]!,
          id: "legacy-agent",
          message: { ...rows[0]!.message, createdBy: "agent", creationSource: "server" },
        },
      ]).map(({ id }) => id),
    ).toEqual(["input-0", "input-1"]);
  });

  it.each(["", "Ultrathink:\n"])(
    "omits bootstrap text from the minimap label and tooltip (%j)",
    (prefix) => {
      const at = "2026-10-01T00:00:00Z";
      const items = deriveTimelineMinimapItems([
        {
          kind: "message",
          id: "image-only",
          createdAt: at,
          showAssistantMeta: false,
          showAssistantCopyButton: false,
          assistantCopyStreaming: false,
          message: {
            id: MessageId.make("image-only"),
            role: "user",
            text: prefix + ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
            runId: null,
            streaming: false,
            createdAt: at,
            updatedAt: at,
          },
        },
      ]);
      expect(items).toEqual([{ id: "image-only", rowIndex: 0, userText: "", assistantText: null }]);
      expect(resolveTimelineMinimapPreview(items[0]!)?.userText).toBeNull();
    },
  );
});

describe("resolveTimelineMinimapPreview", () => {
  it("previews a thread autolink as prose, not its URL", () => {
    const preview = resolveTimelineMinimapPreview({
      id: "turn-1",
      rowIndex: 0,
      userText: null,
      assistantText:
        "Started <t3-thread://v2/env-1/thread-1> and [Fix CI](t3-thread://v2/env-1/t2).",
    });
    expect(preview?.assistantText).toBe("Started a thread and Fix CI.");
  });
});
