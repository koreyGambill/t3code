// @effect-diagnostics nodeBuiltinImport:off - builds real Git layouts on disk.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { resolvePrimaryCheckout } from "./primary-checkout.ts";

const git = (cwd: string, ...args: Array<string>) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "ignore" },
  );

function withLayout(run: (root: string) => void) {
  const root = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "setup-wt-")));
  try {
    run(root);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
}

function mainCheckout(root: string): string {
  const main = NodePath.join(root, "main");
  NodeFS.mkdirSync(main);
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  return main;
}

describe("resolvePrimaryCheckout", () => {
  it("prefers T3CODE_PROJECT_ROOT when the T3 setup action provides it", () =>
    withLayout((root) => {
      const main = mainCheckout(root);
      expect(resolvePrimaryCheckout(main, { T3CODE_PROJECT_ROOT: root })).toBe(root);
    }));

  it("refuses a T3CODE_PROJECT_ROOT that is not a directory", () =>
    withLayout((root) => {
      const main = mainCheckout(root);
      const missing = NodePath.join(root, "missing");
      expect(() => resolvePrimaryCheckout(main, { T3CODE_PROJECT_ROOT: missing })).toThrow(missing);
    }));

  it("derives the main checkout of a linked worktree from Git", () =>
    withLayout((root) => {
      const main = mainCheckout(root);
      const linked = NodePath.join(root, "linked");
      git(main, "worktree", "add", "-q", linked);
      expect(resolvePrimaryCheckout(linked, {})).toBe(main);
    }));

  it("treats the main checkout as its own primary", () =>
    withLayout((root) => {
      const main = mainCheckout(root);
      expect(resolvePrimaryCheckout(main, { T3CODE_PROJECT_ROOT: "" })).toBe(main);
    }));

  it("has no primary checkout for a worktree of a bare repository", () =>
    withLayout((root) => {
      const main = mainCheckout(root);
      const bare = NodePath.join(root, "bare.git");
      git(root, "clone", "-q", "--bare", main, bare);
      const linked = NodePath.join(root, "linked");
      git(bare, "worktree", "add", "-q", linked);
      expect(resolvePrimaryCheckout(linked, {})).toBeUndefined();
    }));

  it("has no primary checkout outside Git", () =>
    withLayout((root) => {
      expect(resolvePrimaryCheckout(root, {})).toBeUndefined();
    }));
});
