import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CheckpointRef } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { describeCheckpointDrift, formatCheckpointDrift } from "./CheckpointDrift.ts";

const gitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-checkpoint-drift-config-",
    }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const identity = ["-c", "user.name=t", "-c", "user.email=t@example.com"];

it.effect("reports moved HEAD, changed and new untracked paths, ignoring unchanged untracked", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const cwd = yield* fs.makeTempDirectoryScoped({
      prefix: "t3-checkpoint-drift-",
    });
    const run = (args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
      git
        .execute({
          operation: "test",
          cwd,
          args: [...identity, ...args],
          ...(env ? { env } : {}),
        })
        .pipe(Effect.map((result) => result.stdout.trim()));
    const write = (name: string, text: string) => fs.writeFileString(path.join(cwd, name), text);
    yield* run(["init", "-q"]);
    yield* write("a.txt", "a");
    yield* write("kept.txt", "same");
    yield* run(["add", "a.txt", "kept.txt"]);
    yield* run(["commit", "-qm", "a"]);
    const capturedHead = yield* run(["rev-parse", "HEAD"]);
    yield* write("untracked.txt", "u");
    yield* write("edited-untracked.txt", "before");
    // Mirrors checkpoint capture: every file, untracked included, with HEAD as parent.
    const env = {
      ...process.env,
      GIT_INDEX_FILE: path.join(cwd, ".git", "drift-index"),
    };
    yield* run(["read-tree", "HEAD"], env);
    yield* run(["add", "-A"], env);
    const tree = yield* run(["write-tree"], env);
    const snapshot = yield* run(["commit-tree", tree, "-p", "HEAD", "-m", "snapshot"]);
    yield* run(["update-ref", "refs/t3/drift", snapshot]);

    yield* write("a.txt", "a2");
    yield* write("edited-untracked.txt", "after");
    yield* write("new.txt", "n");
    yield* write("b.txt", "b");
    yield* run(["add", "b.txt"]);
    yield* run(["commit", "-qm", "b"]);
    const currentHead = yield* run(["rev-parse", "HEAD"]);

    const drift = yield* describeCheckpointDrift(git, {
      cwd,
      checkpointRef: CheckpointRef.make("refs/t3/drift"),
      maxPaths: 50,
    });
    assert.deepStrictEqual(drift, {
      snapshotFound: true,
      capturedHead,
      currentHead,
      commits: [`${currentHead.slice(0, 7)} b`],
      changedPaths: ["a.txt", "b.txt", "edited-untracked.txt"],
      newUntrackedPaths: ["new.txt"],
      truncated: false,
    });

    const capped = yield* describeCheckpointDrift(git, {
      cwd,
      checkpointRef: CheckpointRef.make("refs/t3/drift"),
      maxPaths: 1,
    });
    assert.isTrue(capped.truncated);
    assert.match(formatCheckpointDrift(capped), /partial/);

    const isolated = yield* describeCheckpointDrift(git, {
      cwd,
      checkpointRef: CheckpointRef.make("refs/t3/drift"),
      maxPaths: 50,
      commit: currentHead,
    });
    assert.deepStrictEqual(isolated.changedPaths, [
      "b.txt",
      "edited-untracked.txt",
      "untracked.txt",
    ]);
    assert.deepStrictEqual(isolated.newUntrackedPaths, []);
    assert.deepStrictEqual(isolated.commits, drift.commits);
    assert.match(formatCheckpointDrift(isolated), /Commits since then: .* b/);
    const invalidCommit = yield* describeCheckpointDrift(git, {
      cwd,
      checkpointRef: CheckpointRef.make("refs/t3/drift"),
      maxPaths: 50,
      commit: "missing-commit",
    }).pipe(Effect.flip);
    assert.strictEqual(invalidCommit._tag, "GitCommandError");

    const missing = yield* describeCheckpointDrift(git, {
      cwd,
      checkpointRef: CheckpointRef.make("refs/t3/gone"),
      maxPaths: 50,
    });
    assert.isFalse(missing.snapshotFound);
    assert.strictEqual(missing.currentHead, currentHead);
    assert.match(formatCheckpointDrift(missing), /snapshot for that point is gone/);
  }).pipe(Effect.provide(gitLayer)),
);
