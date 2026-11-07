// @effect-diagnostics nodeBuiltinImport:off - setup runs before `vp i`, so only Node built-ins exist.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/**
 * The checkout whose env files a worktree links. T3's setup action names it in
 * T3CODE_PROJECT_ROOT; other runners such as `xwing app install` rely on Git.
 * Worktrees of a bare repository have no primary checkout, so this returns undefined.
 */
export function resolvePrimaryCheckout(
  worktree: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const configured = env.T3CODE_PROJECT_ROOT?.trim();
  if (configured) {
    if (!NodeFS.statSync(configured, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`T3CODE_PROJECT_ROOT is not a directory: ${configured}`);
    }
    return configured;
  }
  const commonDir = NodeChildProcess.spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: worktree, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const gitDir = commonDir.status === 0 ? commonDir.stdout.trim() : "";
  return NodePath.basename(gitDir) === ".git" ? NodePath.dirname(gitDir) : undefined;
}
