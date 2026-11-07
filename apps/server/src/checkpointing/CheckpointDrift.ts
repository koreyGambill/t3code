import type { CheckpointRef, GitCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/** How a checkout differs from a checkpoint snapshot, which captures tracked and untracked files. */
export interface CheckpointDrift {
  /** False when the snapshot ref no longer resolves; nothing else is then known about the point. */
  readonly snapshotFound: boolean;
  /** HEAD when the snapshot was taken, which is the snapshot commit's parent. */
  readonly capturedHead: string | null;
  readonly currentHead: string | null;
  readonly commits: ReadonlyArray<string>;
  /** Paths whose content differs from the snapshot, or that the snapshot had and the checkout lacks. */
  readonly changedPaths: ReadonlyArray<string>;
  /** Untracked paths absent from the snapshot. */
  readonly newUntrackedPaths: ReadonlyArray<string>;
  /** A path list was cut at the cap or git's output limit, so the lists are partial. */
  readonly truncated: boolean;
}

const MAX_OUTPUT_BYTES = 256 * 1024;

export const describeCheckpointDrift = Effect.fn("CheckpointDrift.describe")(function* (
  git: Pick<GitVcsDriver.GitVcsDriver["Service"], "execute">,
  input: {
    readonly cwd: string;
    readonly checkpointRef: CheckpointRef;
    readonly maxPaths: number;
    /** Compare with this commit, as a fresh worktree made from it has, instead of the checkout. */
    readonly commit?: string;
  },
): Effect.fn.Return<CheckpointDrift, GitCommandError> {
  const run = (args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    git.execute({
      operation: "CheckpointDrift.describe",
      cwd: input.cwd,
      args: ["-c", "core.quotePath=false", ...args],
      allowNonZeroExit,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });
  const snapshot = `${input.checkpointRef}^{commit}`;
  const head = yield* run(["rev-parse", "--verify", "--quiet", "HEAD"], true);
  const currentHead = input.commit ?? (head.exitCode === 0 ? head.stdout.trim() || null : null);
  const parents = yield* run(["log", "-1", "--format=%P", snapshot], true);
  const capturedHead = parents.exitCode === 0 ? parents.stdout.trim().split(" ")[0] || null : null;
  const commitLog =
    capturedHead === null || currentHead === null || capturedHead === currentHead
      ? undefined
      : yield* run(["log", "-11", "--format=%h %s", `${capturedHead}..${currentHead}`]);
  const commits = commitLog?.stdout.trim().split("\n").filter(Boolean) ?? [];
  const commitsTruncated = commits.length > 10 || commitLog?.stdoutTruncated === true;
  if (parents.exitCode === 0 && input.commit !== undefined) {
    const committed = yield* run([
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      "--no-ext-diff",
      snapshot,
      input.commit,
    ]);
    const paths = committed.stdout.split("\0").filter((path) => path.length > 0);
    return {
      snapshotFound: true,
      capturedHead,
      currentHead: input.commit,
      commits: commits.slice(0, 10),
      changedPaths: paths.slice(0, input.maxPaths),
      newUntrackedPaths: [],
      truncated: commitsTruncated || committed.stdoutTruncated || paths.length > input.maxPaths,
    };
  }
  if (parents.exitCode !== 0) {
    return {
      snapshotFound: false,
      capturedHead: null,
      currentHead,
      commits: [],
      changedPaths: [],
      newUntrackedPaths: [],
      truncated: false,
    };
  }
  const nulList = (stdout: string) => stdout.split("\0").filter((path) => path.length > 0);
  const changed = yield* run([
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    snapshot,
  ]);
  const untracked = yield* run(["ls-files", "--others", "--exclude-standard", "-z"]);
  const untrackedAll = nulList(untracked.stdout);
  const untrackedPaths = untrackedAll.slice(0, input.maxPaths);
  // Snapshots include untracked files, which the diff above sees as deleted; compare their content.
  const snapshotBlobs = new Map<string, string>();
  if (untrackedPaths.length > 0) {
    const tree = yield* run(["ls-tree", "-r", "-z", snapshot, "--", ...untrackedPaths]);
    for (const entry of nulList(tree.stdout)) {
      const tab = entry.indexOf("\t");
      snapshotBlobs.set(entry.slice(tab + 1), entry.slice(0, tab).split(" ")[2] ?? "");
    }
  }
  const kept = [...snapshotBlobs.keys()].filter((path) => !path.includes("\n"));
  const unchangedUntracked = new Set<string>();
  if (kept.length > 0) {
    const hashed = yield* git.execute({
      operation: "CheckpointDrift.describe",
      cwd: input.cwd,
      args: ["hash-object", "--stdin-paths"],
      stdin: `${kept.join("\n")}\n`,
      allowNonZeroExit: true,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });
    if (hashed.exitCode === 0) {
      hashed.stdout
        .trim()
        .split("\n")
        .forEach((oid, index) => {
          const path = kept[index]!;
          if (oid === snapshotBlobs.get(path)) unchangedUntracked.add(path);
        });
    }
  }
  const changedPaths = nulList(changed.stdout).filter((path) => !unchangedUntracked.has(path));
  return {
    snapshotFound: true,
    capturedHead,
    currentHead,
    commits: commits.slice(0, 10),
    changedPaths: changedPaths.slice(0, input.maxPaths),
    newUntrackedPaths: untrackedPaths.filter((path) => !snapshotBlobs.has(path)),
    truncated:
      commitsTruncated ||
      changed.stdoutTruncated ||
      untracked.stdoutTruncated ||
      changedPaths.length > input.maxPaths ||
      untrackedAll.length > input.maxPaths,
  };
});

/** Note for a child whose conversation starts at a past point while its files are current. */
export function formatCheckpointDrift(drift: CheckpointDrift | null): string {
  const intro =
    "Your conversation history comes from an earlier point. Files were not rewound to it: you see the current checkout.";
  if (drift === null) {
    return `${intro} File changes since that point could not be determined. Read files before relying on what the history says about them.`;
  }
  if (!drift.snapshotFound) {
    return `${intro} The file snapshot for that point is gone, so changes since it are unknown. Read files before relying on what the history says about them.`;
  }
  const short = (sha: string | null) => (sha === null ? "none" : sha.slice(0, 12));
  const lines = [
    drift.capturedHead === drift.currentHead
      ? `HEAD is unchanged (${short(drift.currentHead)}).`
      : `HEAD moved from ${short(drift.capturedHead)} to ${short(drift.currentHead)}.`,
  ];
  if (drift.commits.length > 0) {
    lines.push(`Commits since then: ${drift.commits.join("; ")}.`);
  }
  if (drift.changedPaths.length > 0) {
    lines.push(`Changed since then: ${drift.changedPaths.join(", ")}.`);
  }
  if (drift.newUntrackedPaths.length > 0) {
    lines.push(`New untracked since then: ${drift.newUntrackedPaths.join(", ")}.`);
  }
  if (drift.changedPaths.length === 0 && drift.newUntrackedPaths.length === 0 && !drift.truncated) {
    lines.push("No file has changed since then.");
  }
  if (drift.truncated) {
    lines.push("These lists are partial; run git status and git diff for the rest.");
  }
  return `${intro} ${lines.join(" ")}`;
}
