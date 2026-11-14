import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { ArgSpec, Context } from "@sparkwing/sdk";

export const checkoutArgs: ArgSpec[] = [
  {
    name: "worktree",
    type: "string",
    required: true,
    description: "Absolute path of the checkout to run in",
  },
  {
    name: "evidence",
    type: "string",
    description:
      "Absolute directory for command logs (default ~/evidence/t3code/sparkwing/runs/<pipeline>/<run id>)",
  },
];

export interface Checkout {
  readonly root: string;
  readonly evidence: string;
  readonly nodeVersion: string;
  readonly env: Readonly<Record<string, string>>;
}

/** Resolves --worktree and --evidence, and the Node runtime the checkout's engines.node pins. */
export function checkout(ctx: Context): Checkout {
  const root = ctx.args.worktree ?? "";
  if (!NodePath.isAbsolute(root)) throw new Error(`--worktree must be absolute, got "${root}"`);
  if (!NodeFS.existsSync(NodePath.join(root, ".git")))
    throw new Error(`--worktree ${root} is not the root of a git checkout`);
  const manifest = JSON.parse(NodeFS.readFileSync(NodePath.join(root, "package.json"), "utf8"));
  const nodeVersion: unknown = manifest.engines?.node;
  if (typeof nodeVersion !== "string") throw new Error(`${root}/package.json has no engines.node`);
  const home = NodeOS.homedir();
  const nodeBin = NodePath.join(home, ".vite-plus/js_runtime/node", nodeVersion, "bin");
  if (!NodeFS.existsSync(NodePath.join(nodeBin, "node")))
    throw new Error(`Node ${nodeVersion} (engines.node) is missing at ${nodeBin}; run vp i first`);

  const evidence =
    ctx.args.evidence ||
    NodePath.join(home, "evidence/t3code/sparkwing/runs", ctx.run.pipeline, ctx.run.id);
  if (!NodePath.isAbsolute(evidence)) throw new Error(`--evidence must be absolute: ${evidence}`);
  NodeFS.mkdirSync(evidence, { recursive: true });

  return {
    root,
    evidence,
    nodeVersion,
    env: {
      PATH: [nodeBin, NodePath.join(home, ".vite-plus/bin"), process.env.PATH ?? ""].join(":"),
      PLAYWRIGHT_BROWSERS_PATH: NodePath.join(home, ".cache/ms-playwright"),
      VITEST_MAX_WORKERS: "2",
    },
  };
}

/** Runs argv under nice in the checkout, teeing combined output to <evidence>/<name>.log. */
export async function logged(
  ctx: Context,
  co: Checkout,
  name: string,
  argv: readonly [string, ...string[]],
  env: Readonly<Record<string, string>> = {},
): Promise<string> {
  const log = NodePath.join(co.evidence, `${name}.log`);
  ctx.log.info(`${name}: ${argv.join(" ")}`, { log });
  try {
    await ctx
      .exec(
        ["bash", "-c", 'set -o pipefail; nice -n 10 "$@" 2>&1 | tee "$SW_LOG"', "bash", ...argv],
        { cwd: co.root, env: { ...co.env, ...env, SW_LOG: log } },
      )
      .run();
  } catch (error) {
    throw new Error(`${name} failed; log: ${log}`, { cause: error });
  }
  return log;
}

export function git(root: string, ...args: string[]): string {
  // Unquoted paths, as check:changed reads them, so non-ASCII names hash and stat correctly.
  return NodeChildProcess.execFileSync("git", ["-C", root, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/** check:changed's base: the merge base with ref, or the closest merge base with any remote's main. */
export function comparisonBase(root: string, ref?: string): string {
  const candidates = ref
    ? [ref]
    : git(root, "remote")
        .split("\n")
        .filter(Boolean)
        .map((remote) => `refs/remotes/${remote}/main`);
  let closest: { base: string; ahead: number } | undefined;
  for (const candidate of candidates) {
    let base: string;
    try {
      base = git(root, "merge-base", "HEAD", candidate);
    } catch {
      continue;
    }
    const ahead = Number(git(root, "rev-list", "--count", `${base}..HEAD`));
    if (!closest || ahead < closest.ahead) closest = { base, ahead };
  }
  if (!closest) throw new Error(`No merge base with ${candidates.join(", ") || "a remote main"}`);
  return closest.base;
}

/** Changed and untracked paths against base, as check:changed and CI see them. */
export function changedFiles(root: string, base: string): string[] {
  const lines = (...args: string[]) => git(root, ...args).split("\n").filter(Boolean);
  return [
    ...new Set([
      ...lines("diff", "--name-only", "--no-renames", base, "--"),
      ...lines("ls-files", "--others", "--exclude-standard"),
    ]),
  ].sort();
}

/**
 * The inputs check:changed reads, hashed as scripts/check-changed.ts keys its own replay: the
 * binary diff against base, raw bytes of changed, untracked and ignored generated files, and
 * install state. Includes the checkout path because ignored caches differ per worktree.
 */
export function checkChangedInputs(root: string, base: string): string {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(`${root}\0${base}\0${process.env.CI ?? ""}\0`);
  hash.update(
    NodeChildProcess.execFileSync(
      "git",
      ["-C", root, "diff", "--binary", "--no-renames", "--no-ext-diff", "--no-textconv", base, "--"],
      { maxBuffer: 1024 * 1024 * 1024 },
    ),
  );
  const ignored = git(
    root,
    "ls-files", "--others", "--ignored", "--exclude-standard", "--",
    ":(glob)**/.generated/**",
    ":(glob)**/.astro/**",
    ":(glob)**/*.d.ts",
    ":(glob)**/.env*",
    ":(exclude,glob)**/node_modules/**",
  )
    .split("\n")
    .filter(Boolean);
  for (const file of [
    ...changedFiles(root, base),
    ...ignored,
    "node_modules/.modules.yaml",
    "node_modules/.pnpm/lock.yaml",
  ]) {
    hash.update(`\0${file}\0`);
    const path = NodePath.join(root, file);
    if (NodeFS.statSync(path, { throwIfNoEntry: false })?.isFile()) hash.update(NodeFS.readFileSync(path));
  }
  return hash.digest("hex");
}

interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly hasTest: boolean;
  readonly deps: readonly string[];
}

export interface Changes {
  readonly affected: string[];
  readonly outputs: {
    readonly typecheck: boolean;
    readonly build: boolean;
    readonly desktop_launch: boolean;
    readonly test: boolean;
    readonly test_packages: string;
    readonly test_web: boolean;
    readonly test_server: boolean;
    readonly rust: boolean;
    readonly release_smoke: boolean;
    readonly mobile_native: boolean;
  };
}

/** CI's job decisions from the checkout's own .github/scripts/ci-changes.cjs. */
export function decideChanges(root: string, files: readonly string[] | null, full: boolean): Changes {
  const require = NodeModule.createRequire(NodePath.join(root, "package.json"));
  const ciChanges = require("./.github/scripts/ci-changes.cjs") as {
    readWorkspace(): WorkspacePackage[];
    decide(files: readonly string[] | null, packages: WorkspacePackage[], full: boolean): Changes;
  };
  return ciChanges.decide(files, ciChanges.readWorkspace(), full);
}

export const CODE = /\.(?:[cm]?[jt]sx?|astro)$/;
