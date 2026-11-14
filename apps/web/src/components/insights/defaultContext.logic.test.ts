import type { DefaultContextItem, DefaultContextPreview } from "@t3tools/contracts";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { defaultContextSummary, homeOf, shortenPath } from "./defaultContext.logic";

const item = (overrides: Partial<DefaultContextItem>): DefaultContextItem => ({
  id: overrides.label ?? "x",
  category: "t3",
  label: "x",
  source: "test",
  delivery: "every-turn",
  bytes: 0,
  estimatedTokens: 0,
  counted: true,
  readable: true,
  ...overrides,
});

const preview = (items: ReadonlyArray<DefaultContextItem>): DefaultContextPreview => ({
  threadId: ThreadId.make("thread"),
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  driver: "claudeAgent",
  model: "opus",
  cwd: null,
  support: "exact",
  filesSupported: true,
  notes: [],
  items,
  notVisible: [],
  lastTurn: null,
  estimateMethod: "",
});

describe("defaultContextSummary", () => {
  it("totals only counted items and orders categories and groups", () => {
    const summary = defaultContextSummary(
      preview([
        item({ label: "tool", category: "tools", bytes: 400, estimatedTokens: 100 }),
        item({
          label: "deferred",
          category: "tools",
          bytes: 4000,
          estimatedTokens: 1000,
          counted: false,
        }),
        item({
          label: "CLAUDE.md",
          category: "files",
          bytes: 400,
          estimatedTokens: 100,
          status: "not-loaded",
        }),
        item({ label: "runtime", bytes: 800, estimatedTokens: 200, status: "changed" }),
        item({
          label: "last",
          category: "custom",
          bytes: 9,
          counted: false,
          status: "last-turn-only",
        }),
      ]),
    );
    expect(summary).toMatchObject({ bytes: 1600, tokens: 400, attention: 2 });
    expect(summary.categories.map((category) => [category.category, category.share])).toEqual([
      ["t3", 0.5],
      ["files", 0.25],
      ["tools", 0.25],
    ]);
    expect(summary.groups.map((group) => [group.category, group.items.length])).toEqual([
      ["t3", 1],
      ["files", 1],
      ["tools", 2],
      ["custom", 1],
    ]);
  });
});

describe("paths", () => {
  it("collapses the home folder only on a whole path segment", () => {
    const home = homeOf(["/srv/x", "/home/korey/code/AGENTS.md"]);
    expect(home).toBe("/home/korey");
    expect(shortenPath("/home/korey/.claude/CLAUDE.md", home)).toBe("~/.claude/CLAUDE.md");
    expect(shortenPath("/home/koreyx/CLAUDE.md", home)).toBe("/home/koreyx/CLAUDE.md");
    expect(shortenPath("/etc/claude-code/CLAUDE.md", null)).toBe("/etc/claude-code/CLAUDE.md");
  });
});
