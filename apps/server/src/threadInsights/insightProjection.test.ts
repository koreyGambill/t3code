import { describe, expect, it } from "@effect/vitest";
import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { projectLoadEvent } from "./insightProjection.ts";

const base = {
  id: TurnItemId.make("read"),
  threadId: ThreadId.make("thread"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed",
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: DateTime.makeUnsafe("2026-11-06T00:00:00Z"),
} as const;

describe("load event projection", () => {
  it("distinguishes skill and instruction reads, search results, and inferred shell activity", () => {
    const read: OrchestrationV2TurnItem = {
      ...base,
      type: "dynamic_tool",
      toolName: "mcp__files__read_file",
      input: { path: "/repo/SKILL.md" },
      output: "abcé",
    };
    expect(projectLoadEvent(read)).toMatchObject({
      kind: "skill",
      evidence: "reported",
      outputBytes: 5,
      estimatedOutputTokens: 2,
    });
    expect(
      projectLoadEvent({ ...read, input: { file_path: "/repo/AGENTS.md" }, outputOmitted: true }),
    ).toMatchObject({ kind: "instructions", outputBytes: null });
    expect(
      projectLoadEvent({
        ...base,
        type: "file_search",
        results: [{ fileName: "/repo/SKILL.md", line: 1, preview: "match" }],
      }),
    ).toMatchObject({ kind: "search", outputBytes: null });
    expect(
      projectLoadEvent({
        ...base,
        type: "command_execution",
        input: "sed -n '1,20p' /repo/AGENTS.md",
        output: "instructions",
      }),
    ).toMatchObject({ kind: "instructions", evidence: "inferred", paths: ["/repo/AGENTS.md"] });
    expect(projectLoadEvent({ ...read, toolName: "write_file" })).toBeNull();
    for (const [input, path] of [
      ["/usr/bin/zsh -lc 'cat /repo/AGENTS.md'", "/repo/AGENTS.md"],
      ['/bin/bash -lc "cat /repo/AGENTS.md"', "/repo/AGENTS.md"],
      ["/usr/bin/zsh -lc 'sed -n '\\''1,20p'\\'' /repo/AGENTS.md'", "/repo/AGENTS.md"],
      ['/bin/bash -c "cat \\"/repo/a b/AGENTS.md\\""', "/repo/a b/AGENTS.md"],
      ["cat AGENTS.md", "AGENTS.md"],
    ] as const) {
      expect(
        projectLoadEvent({ ...base, type: "command_execution", input, output: "instructions" }),
      ).toMatchObject({
        kind: "instructions",
        evidence: "inferred",
        paths: [path],
      });
    }
    expect(
      projectLoadEvent({
        ...base,
        type: "command_execution",
        input: "/usr/bin/zsh -lc 'cat /skills/review/SKILL.md /repo/MEMORY.md'",
        output: "No such file or directory",
        exitCode: 1,
      }),
    ).toMatchObject({
      kind: "skill",
      paths: ["/skills/review/SKILL.md", "/repo/MEMORY.md"],
      status: "failed",
    });
    expect(
      projectLoadEvent({ ...read, toolName: "Skill", input: { skill: "code-review" } }),
    ).toMatchObject({ kind: "skill", label: "code-review", paths: [] });
  });
});
