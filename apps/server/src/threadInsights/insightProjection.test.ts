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
    for (const command of [
      "overwing search context engines",
      "overwing context --repo /repo",
      "overwing standards show standard-comments",
    ]) {
      expect(
        projectLoadEvent({ ...base, type: "command_execution", input: command, output: "notes" }),
      ).toMatchObject({ kind: "knowledge", evidence: "inferred", label: command });
    }
    for (const toolName of ["mcp__t3_code__list_read", "mcp__t3_code__artifact_read"]) {
      expect(
        projectLoadEvent({
          ...read,
          toolName,
          input: { threadId: "other" },
        }),
      ).toMatchObject({ kind: "resource", label: `${toolName} other` });
    }
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
    for (const [input, paths] of [
      ["git log | head -5", []],
      ["git log | tail -20", []],
      ["git log | grep release.md", []],
      ["cd /other/repo && cat README.md", ["README.md"]],
      ["cat README.md > /tmp/output.md", ["README.md"]],
      ["cat README.md >> /tmp/output.md", ["README.md"]],
      ["cat README.md 2> /tmp/errors.log", ["README.md"]],
      ["cat README.md\ncat AGENTS.md", ["README.md", "AGENTS.md"]],
      ["sed -i 's/a/b/' /repo/README.md", []],
      ["sed --in-place=.bak 's/a/b/' /repo/README.md", []],
      ["/usr/bin/cat README.md", ["README.md"]],
      ["head -5 README.md", ["README.md"]],
      ["rg 'release.md' README.md", ["README.md"]],
      ["cat README.md | head -5", ["README.md"]],
    ] as const) {
      const event = projectLoadEvent({ ...base, type: "command_execution", input, output: "text" });
      if (paths.length) expect(event?.paths, input).toEqual(paths);
      else expect(event, input).toBeNull();
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
