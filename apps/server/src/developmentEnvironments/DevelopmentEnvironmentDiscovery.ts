import {
  CommandId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DevelopmentEnvironmentCheckout,
  type ThreadId,
  type XwingEnvironmentSummary,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as XwingEnvironments from "../xwing/XwingEnvironments.ts";

/** Discovers agent-owned environments without changing a thread's execution directory. */
export class DevelopmentEnvironmentDiscovery extends Context.Service<
  DevelopmentEnvironmentDiscovery,
  {
    readonly refresh: (threadId?: ThreadId) => Effect.Effect<void>;
    readonly writableRoots: (
      threadId: ThreadId,
      cwd: string | null,
    ) => Effect.Effect<readonly string[]>;
  }
>()("t3/developmentEnvironments/DevelopmentEnvironmentDiscovery") {}

const Activity = Schema.Struct({
  type: Schema.String,
  agent: Schema.optional(
    Schema.Struct({ harness: Schema.String, session: Schema.optional(Schema.String) }),
  ),
});
const decodeActivity = Schema.decodeUnknownEffect(Schema.fromJsonString(Activity));
const key = (harness: string, session: string) => `${harness}:${session}`;
const linkKey = (link: OrchestrationV2DevelopmentEnvironmentCheckout) =>
  `${link.xwingEnvironmentId}:${link.checkoutPath}`;

export const make = Effect.fn("DevelopmentEnvironmentDiscovery.make")(function* () {
  const xwing = yield* XwingEnvironments.XwingEnvironments;
  const runner = yield* ProcessRunner.ProcessRunner;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const contained = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const repositoryOf = Effect.fn("DevelopmentEnvironmentDiscovery.repositoryOf")(
    function* (cwd: string) {
      const output = yield* git.execute({
        operation: "DevelopmentEnvironmentDiscovery.repositoryOf",
        cwd,
        args: [
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
          "--absolute-git-dir",
          "--show-toplevel",
        ],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      });
      const [common, gitDirectory, top] = output.stdout.trimEnd().split(/\r?\n/u);
      if (output.exitCode !== 0 || !common || !gitDirectory || !top) return null;
      return yield* Effect.all({
        commonDir: fs.realPath(common),
        gitDir: fs.realPath(gitDirectory),
        topLevel: fs.realPath(top),
      });
    },
    Effect.orElseSucceed(() => null),
  );
  const registered = Effect.fn("DevelopmentEnvironmentDiscovery.registered")(
    function* (repository: { commonDir: string; topLevel: string }) {
      const output = yield* git.execute({
        operation: "DevelopmentEnvironmentDiscovery.registered",
        cwd: repository.topLevel,
        args: ["worktree", "list", "--porcelain", "-z"],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      });
      if (output.exitCode !== 0) return false;
      for (const field of output.stdout.split("\0")) {
        if (!field.startsWith("worktree ")) continue;
        const registeredPath = yield* fs
          .realPath(field.slice("worktree ".length))
          .pipe(Effect.orElseSucceed(() => null));
        if (registeredPath === repository.topLevel) return true;
      }
      return false;
    },
    Effect.orElseSucceed(() => false),
  );
  const checkouts = Effect.fn("DevelopmentEnvironmentDiscovery.checkouts")(
    function* (environment: XwingEnvironmentSummary) {
      const root = yield* fs.realPath(environment.rootPath);
      const results = yield* Effect.forEach(
        environment.repositories.filter((repo) => repo.present),
        (repo) =>
          Effect.gen(function* () {
            const checkout = yield* fs.realPath(repo.path);
            if (!contained(root, checkout)) return null;
            const [source, target] = yield* Effect.all(
              [repositoryOf(repo.sourcePath), repositoryOf(checkout)],
              { concurrency: 2 },
            );
            if (
              source === null ||
              target === null ||
              source.commonDir !== target.commonDir ||
              target.topLevel !== checkout ||
              !(yield* registered(target))
            )
              return null;
            return {
              link: {
                xwingEnvironmentId: environment.id,
                repositorySource: repo.sourcePath,
                checkoutPath: checkout,
                number: environment.number ?? null,
                name: environment.name,
              } satisfies OrchestrationV2DevelopmentEnvironmentCheckout,
              commonDir: target.commonDir,
            };
          }).pipe(Effect.orElseSucceed(() => null)),
        { concurrency: 2 },
      );
      return results.filter((result) => result !== null);
    },
    Effect.orElseSucceed(() => []),
  );

  const refresh = Effect.fn("DevelopmentEnvironmentDiscovery.refresh")(
    function* (threadId?: ThreadId) {
      const threads = new Map<ThreadId, OrchestrationV2AppThread>();
      const children = new Map<ThreadId, ThreadId[]>();
      const include = Effect.fn("DevelopmentEnvironmentDiscovery.include")(function* (
        id: ThreadId,
      ) {
        if (threads.has(id)) return;
        const thread = yield* store.getThread(id);
        threads.set(id, thread);
        const parent = thread.lineage.parentThreadId;
        if (parent !== null) {
          const siblings = children.get(parent) ?? [];
          siblings.push(id);
          children.set(parent, siblings);
        }
      });
      const snapshot = yield* store.getShellSnapshot(
        threadId === undefined ? undefined : { familyOf: threadId },
      );
      for (const shell of [...snapshot.threads, ...snapshot.archivedThreads])
        yield* include(shell.id);
      if (threadId !== undefined) yield* include(threadId);
      // App-owned tasks remain discoverable even after their shell leaves the active family.
      for (const id of threads.keys()) {
        for (const childId of yield* store.listAppOwnedChildThreadIds(id)) yield* include(childId);
        const parentId = threads.get(id)!.lineage.parentThreadId;
        if (parentId !== null) yield* include(parentId);
      }
      if (threads.size === 0) return;
      const sessions = new Map<ThreadId, Set<string>>();
      for (const id of threads.keys()) {
        const records = yield* store.getThreadRecords(id, ["providerThreads"]);
        sessions.set(
          id,
          new Set(
            records.providerThreads.flatMap((provider) => {
              const nativeId = provider.nativeThreadRef?.nativeId;
              const harness =
                provider.driver === "codex"
                  ? "codex"
                  : provider.driver === "claudeAgent"
                    ? "claude-code"
                    : null;
              return nativeId && harness ? [key(harness, nativeId)] : [];
            }),
          ),
        );
      }
      const descendants = (id: ThreadId, seen = new Set<ThreadId>()): Set<string> => {
        if (seen.has(id)) return new Set();
        seen.add(id);
        const result = new Set(sessions.get(id));
        for (const child of children.get(id) ?? [])
          for (const session of descendants(child, seen)) result.add(session);
        return result;
      };
      const affected =
        threadId === undefined ? new Set(threads.keys()) : new Set<ThreadId>([threadId]);
      if (threadId !== undefined)
        for (const id of affected) {
          const thread = threads.get(id);
          if (thread !== undefined && thread.lineage.parentThreadId !== null)
            affected.add(thread.lineage.parentThreadId);
        }
      const matches = new Map([...affected].map((id) => [id, descendants(id)]));
      const links = new Map<ThreadId, OrchestrationV2DevelopmentEnvironmentCheckout[]>();
      if ([...matches.values()].every((known) => known.size === 0)) return;
      const environments = yield* xwing.list();
      for (const environment of environments.filter((env) => env.status === "active")) {
        const recorded = yield* runner
          .run({
            command: "xwing",
            args: [
              "env",
              "activity",
              "--session",
              environment.id,
              "--limit",
              "2147483647",
              "-o",
              "json",
            ],
            env: XwingEnvironments.WITHOUT_AGENT_IDENTITY,
          })
          .pipe(
            Effect.flatMap((output) =>
              output.code === 0 && !output.stdoutTruncated
                ? Effect.forEach(
                    output.stdout.split("\n").filter((line) => line.trim() !== ""),
                    (line) => decodeActivity(line),
                  )
                : Effect.succeed([]),
            ),
            Effect.orElseSucceed(() => []),
          );
        const identities = new Set(
          recorded.flatMap((event) =>
            event.type === "agent.session" && event.agent?.session
              ? [key(event.agent.harness, event.agent.session)]
              : [],
          ),
        );
        const owners = [...matches]
          .filter(([, known]) => [...known].some((session) => identities.has(session)))
          .map(([id]) => id);
        if (owners.length === 0) continue;
        const valid = yield* checkouts(environment);
        for (const id of owners)
          links.set(id, [...(links.get(id) ?? []), ...valid.map((checkout) => checkout.link)]);
      }
      for (const [id, discovered] of links) {
        const existing = new Set(
          (threads.get(id)?.linkedDevelopmentEnvironments ?? []).map(linkKey),
        );
        const additions = discovered.filter((link) => !existing.has(linkKey(link)));
        if (additions.length === 0) continue;
        yield* orchestrator.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make(yield* randomUuidV4),
          threadId: id,
          linkDevelopmentEnvironments: additions,
        });
      }
    },
    Effect.catch((cause) => Effect.logWarning("Could not discover Xwing environment links", cause)),
  );

  const writableRoots = Effect.fn("DevelopmentEnvironmentDiscovery.writableRoots")(
    function* (threadId: ThreadId, cwd: string | null) {
      const thread = yield* store.getThread(threadId);
      const roots = new Set<string>();
      const ids = new Set(
        [thread.developmentEnvironment, ...(thread.linkedDevelopmentEnvironments ?? [])].flatMap(
          (link) => (link ? [link.xwingEnvironmentId] : []),
        ),
      );
      if (ids.size > 0) {
        const environments = yield* xwing.list();
        for (const environment of environments.filter(
          (env) => env.status === "active" && ids.has(env.id),
        ))
          for (const checkout of yield* checkouts(environment)) {
            roots.add(checkout.link.checkoutPath);
            roots.add(checkout.commonDir);
          }
      }
      if (cwd !== null && thread.worktreePath !== null) {
        const realCwd = yield* fs.realPath(cwd).pipe(Effect.orElseSucceed(() => null));
        const worktreePath = yield* fs
          .realPath(thread.worktreePath)
          .pipe(Effect.orElseSucceed(() => null));
        if (realCwd !== null && realCwd === worktreePath) {
          const repository = yield* repositoryOf(realCwd);
          if (
            repository !== null &&
            contained(path.join(repository.commonDir, "worktrees"), repository.gitDir) &&
            (yield* registered(repository))
          ) {
            roots.add(realCwd);
            roots.add(repository.commonDir);
          }
        }
      }
      return [...roots];
    },
    Effect.catch((cause) =>
      Effect.logWarning("Could not resolve environment writable roots", cause).pipe(Effect.as([])),
    ),
  );

  return DevelopmentEnvironmentDiscovery.of({ refresh, writableRoots });
});

export const layer = Layer.effect(DevelopmentEnvironmentDiscovery, make());
