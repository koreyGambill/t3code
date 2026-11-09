import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  OrchestrationV2AppThread,
  OrchestrationV2ProviderThread,
  ThreadId,
  XwingEnvironmentId,
  type OrchestrationV2ServerCommand,
  type XwingEnvironmentSummary,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as XwingEnvironments from "../xwing/XwingEnvironments.ts";
import * as Discovery from "./DevelopmentEnvironmentDiscovery.ts";

const id = ThreadId.make("discovery-root");
const childId = ThreadId.make("discovery-child");
const envId = XwingEnvironmentId.make("0123abcd");
const now = DateTime.makeUnsafe("2026-11-09T00:00:00Z");
const decodeThread = Schema.decodeSync(OrchestrationV2AppThread);
const decodeProviderThread = Schema.decodeSync(OrchestrationV2ProviderThread);
const thread = (threadId = id, parentThreadId: ThreadId | null = null) =>
  decodeThread({
    id: threadId,
    createdBy: "user",
    creationSource: "web",
    projectId: "project",
    title: "Scratch",
    providerInstanceId: "codex",
    modelSelection: { instanceId: "codex", model: "gpt" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: id,
      parentThreadId,
      relationshipToParent: parentThreadId ? "subagent" : null,
    },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
  });
const providerThread = (threadId: ThreadId, driver: string, nativeId: string) =>
  decodeProviderThread({
    id: `provider-${threadId}`,
    driver,
    providerInstanceId: driver,
    providerSessionId: null,
    appThreadId: threadId,
    ownerNodeId: null,
    nativeThreadRef: { driver, nativeId, strength: "strong" },
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
  });

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "t3-discovery-" }));
  const source = `${root}/source`;
  const checkout = `${root}/env/repo`;
  yield* fs.makeDirectory(source);
  const run = (cwd: string, args: readonly string[]) =>
    git.execute({
      cwd,
      operation: "test",
      args: [
        "-c",
        "user.name=T3",
        "-c",
        "user.email=t3@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
    });
  yield* run(source, ["init", "--initial-branch=main"]);
  yield* run(source, ["commit", "--allow-empty", "-m", "initial"]);
  yield* run(source, ["worktree", "add", "-b", "work", checkout]);
  const environment: XwingEnvironmentSummary = {
    id: envId,
    number: 1,
    name: "work",
    status: "active",
    rootPath: `${root}/env`,
    createdAt: "now",
    updatedAt: "now",
    repositories: [
      { name: "repo", sourcePath: source, path: checkout, branch: "work", present: true },
    ],
  };
  return { fs, run, root, source, checkout, environment };
});

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "discovery-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.effect(
  "links descendant sessions to their thread and ancestors, matching the harness and avoiding duplicate events",
  () =>
    Effect.gen(function* () {
      const { environment, source, checkout } = yield* fixture;
      const commands: OrchestrationV2ServerCommand[] = [];
      const threads = new Map([
        [id, thread()],
        [childId, thread(childId, id)],
      ]);
      const providers = new Map([
        [id, [providerThread(id, "codex", "root-native")]],
        [childId, [providerThread(childId, "claudeAgent", "child-native")]],
      ]);
      const activityCalls: string[][] = [];
      const service = yield* Discovery.make().pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getThread: (threadId) => Effect.succeed(threads.get(threadId)!),
              getShellSnapshot: () =>
                Effect.succeed({
                  schemaVersion: 2,
                  snapshotSequence: 0,
                  threads: [],
                  archivedThreads: [],
                }),
              listAppOwnedChildThreadIds: (threadId) =>
                Effect.succeed(threadId === id ? [childId] : []),
              getThreadRecords: (threadId) =>
                Effect.succeed({
                  thread: threads.get(threadId)!,
                  providerThreads: providers.get(threadId)!,
                  runs: [],
                  attempts: [],
                  nodes: [],
                  subagents: [],
                  providerSessions: [],
                  providerTurns: [],
                  runtimeRequests: [],
                  messages: [],
                  plans: [],
                  turnItems: [],
                  checkpointScopes: [],
                  checkpoints: [],
                  contextHandoffs: [],
                  contextTransfers: [],
                  visibleTurnItems: [],
                  updatedAt: now,
                }),
            }),
            Layer.mock(Orchestrator.OrchestratorV2)({
              dispatch: (command) =>
                Effect.sync(() => {
                  commands.push(command);
                  if (command.type === "thread.metadata.update")
                    threads.set(command.threadId, {
                      ...threads.get(command.threadId)!,
                      linkedDevelopmentEnvironments: command.linkDevelopmentEnvironments?.map(
                        (link) => ({ ...link, selectedAt: now }),
                      ),
                    });
                  return { sequence: 1, storedEvents: [] };
                }),
            }),
            Layer.mock(XwingEnvironments.XwingEnvironments)({
              list: () => Effect.succeed([environment]),
            }),
            Layer.mock(ProcessRunner.ProcessRunner)({
              run: (input) =>
                Effect.sync(() => {
                  activityCalls.push([...input.args]);
                  return {
                    stdout: [
                      {
                        type: "agent.session",
                        agent: { harness: "claude-code", session: "child-native" },
                      },
                      {
                        type: "agent.session",
                        agent: { harness: "claude-code", session: "root-native" },
                      },
                    ]
                      .map((value) => JSON.stringify(value))
                      .join("\n"),
                    stderr: "",
                    code: ChildProcessSpawner.ExitCode(0),
                    timedOut: false,
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    stdoutInvalidUtf8: false,
                    stderrInvalidUtf8: false,
                  };
                }),
            }),
          ),
        ),
      );
      yield* service.refresh(childId);
      assert.deepEqual(
        commands.map((command) =>
          command.type === "thread.metadata.update"
            ? [
                command.threadId,
                command.linkDevelopmentEnvironments?.map((link) => link.checkoutPath),
              ]
            : [],
        ),
        [
          [childId, [checkout]],
          [id, [checkout]],
        ],
      );
      assert.deepEqual(yield* service.writableRoots(id, null), [checkout, `${source}/.git`]);
      yield* service.refresh(id);
      assert.equal(commands.length, 2);
      threads.set(id, thread());
      threads.set(childId, thread(childId, id));
      providers.set(childId, [providerThread(childId, "codex", "child-native")]);
      yield* service.refresh(childId);
      assert.equal(commands.length, 2);
      providers.set(id, []);
      providers.set(childId, []);
      const count = activityCalls.length;
      yield* service.refresh(id);
      assert.equal(activityCalls.length, count);
      assert.isTrue(
        activityCalls.every((args) => args[1] === "activity" && args.includes("--limit")),
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect(
  "grants only registered contained linked worktrees and their common Git directories",
  () =>
    Effect.gen(function* () {
      const { fs, run, environment, root, source, checkout } = yield* fixture;
      const t3Checkout = `${root}/t3-worktree`;
      yield* run(source, ["worktree", "add", "-b", "t3", t3Checkout]);
      const other = `${root}/other`;
      yield* fs.makeDirectory(other);
      yield* run(other, ["init", "--initial-branch=main"]);
      const escaped = `${root}/env/escape`;
      yield* fs.symlink(other, escaped);
      const linked = {
        ...thread(),
        worktreePath: t3Checkout,
        linkedDevelopmentEnvironments: [
          {
            xwingEnvironmentId: envId,
            repositorySource: source,
            checkoutPath: checkout,
            number: 1,
            name: "work",
            selectedAt: now,
          },
        ],
      };
      const catalog = {
        ...environment,
        repositories: [
          ...environment.repositories,
          { name: "escape", sourcePath: other, path: escaped, branch: "main", present: true },
          { name: "outside", sourcePath: source, path: t3Checkout, branch: "t3", present: true },
          {
            name: "mismatch",
            sourcePath: source,
            path: `${root}/env/unrelated`,
            branch: "main",
            present: true,
          },
        ],
      };
      yield* fs.makeDirectory(`${root}/env/unrelated`);
      yield* run(`${root}/env/unrelated`, ["init", "--initial-branch=main"]);
      const service = yield* Discovery.make().pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getThread: () => Effect.succeed(linked),
            }),
            Layer.mock(Orchestrator.OrchestratorV2)({}),
            Layer.mock(XwingEnvironments.XwingEnvironments)({
              list: () => Effect.succeed([catalog]),
            }),
            Layer.mock(ProcessRunner.ProcessRunner)({}),
          ),
        ),
      );
      assert.deepEqual(yield* service.writableRoots(id, t3Checkout), [
        checkout,
        `${source}/.git`,
        t3Checkout,
      ]);
      assert.deepEqual(yield* service.writableRoots(id, other), [checkout, `${source}/.git`]);
      yield* fs.remove(checkout, { recursive: true });
      assert.deepEqual(yield* service.writableRoots(id, null), []);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
