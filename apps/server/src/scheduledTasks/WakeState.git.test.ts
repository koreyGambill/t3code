import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { pinGitWake, wakeReason } from "./WakeState.ts";

const gitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-wake-git-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.live("a pinned branch wakes after landing even after the source branch is deleted", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const repoPath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-wake-" });
    const git = yield* GitVcsDriver.GitVcsDriver;
    const run = (...args: string[]) =>
      git.execute({ operation: "test.gitWake", cwd: repoPath, args });
    yield* run("init", "-b", "main");
    yield* run(
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--no-verify",
      "--allow-empty",
      "-m",
      "base",
    );
    yield* run("checkout", "-b", "step-3");
    yield* run(
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--no-verify",
      "--allow-empty",
      "-m",
      "step 3",
    );
    const pinned = yield* pinGitWake({ type: "git_landed", repoPath, ref: "step-3" });
    expect(pinned.type === "git_landed" && pinned.ref).toMatch(/^[0-9a-f]{40}$/);
    const task = {
      threadId: null,
      schedule: { type: "interval" as const, everyMs: 60_000, wakeWhen: pinned },
    };
    expect(yield* wakeReason(task)).toBeNull();
    yield* run("checkout", "main");
    yield* run("merge", "--ff-only", "step-3");
    yield* run("branch", "-d", "step-3");
    expect(yield* wakeReason(task)).toContain("landed on main");
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(gitLayer, SqlitePersistence.layerMemory))),
);
