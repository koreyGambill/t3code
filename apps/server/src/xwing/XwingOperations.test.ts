import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  XwingEnvironmentId,
  XwingInvalidInputError,
  XwingOperationFailedError,
  XwingOperationUnsupportedError,
  XwingUnavailableError,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as XwingEnvironments from "./XwingEnvironments.ts";
import * as XwingOperations from "./XwingOperations.ts";

// The fixture executables are POSIX shell scripts.
const windowsHost = HostProcess.Platform.defaultValue() === "win32";
const ID = XwingEnvironmentId.make("18904777e18fcea5");
const ROOT = "/home/dev/.xwing/envs/1";
const isOperationFailure = Schema.is(XwingOperationFailedError);
const encodeOperationFailure = Schema.encodeEffect(Schema.toCodecJson(XwingOperationFailedError));

// Replays out-N, err-N and code-N for the Nth call and records its argv.
const FAKE_XWING = `#!/bin/sh
here=$(dirname "$0")
n=$(( $(cat "$here/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$here/count"
for arg in "$@"; do printf '%s\\n' "$arg"; done > "$here/argv-$n"
if [ -f "$here/script-$n" ]; then . "$here/script-$n"; fi
if [ -f "$here/err-$n" ]; then cat "$here/err-$n" >&2; fi
if [ -f "$here/out-$n" ]; then cat "$here/out-$n"; fi
exit "$(cat "$here/code-$n" 2>/dev/null || echo 0)"
`;

interface FakeResponse {
  readonly script?: string;
  readonly out?: string;
  readonly err?: string;
  readonly code?: number;
}

const withFakeXwing = Effect.fn("test.withFakeXwing")(function* (
  responses: ReadonlyArray<FakeResponse>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3-xwing-ops-",
  });
  const command = path.join(directory, "xwing");
  yield* fileSystem.writeFileString(command, FAKE_XWING);
  yield* fileSystem.chmod(command, 0o755);
  for (const [index, response] of responses.entries()) {
    const n = index + 1;
    if (response.script !== undefined) {
      yield* fileSystem.writeFileString(path.join(directory, `script-${n}`), response.script);
    }
    if (response.out !== undefined) {
      yield* fileSystem.writeFileString(path.join(directory, `out-${n}`), response.out);
    }
    if (response.err !== undefined) {
      yield* fileSystem.writeFileString(path.join(directory, `err-${n}`), response.err);
    }
    yield* fileSystem.writeFileString(
      path.join(directory, `code-${n}`),
      String(response.code ?? 0),
    );
  }
  const service = yield* XwingOperations.make(command).pipe(Effect.provide(ProcessRunner.layer));
  const calls = fileSystem.readFileString(path.join(directory, "count")).pipe(
    Effect.map(Number),
    Effect.orElseSucceed(() => 0),
  );
  const argv = (n: number) =>
    fileSystem
      .readFileString(path.join(directory, `argv-${n}`))
      .pipe(Effect.map((text) => text.split("\n").slice(0, -1)));
  return { service, calls, argv };
});

// Session JSON shaped by Xwing's env.Session encoder for a repair that left work pending.
const partialRepairOutput = JSON.stringify({
  version: 2,
  id: ID,
  number: 1,
  path: ROOT,
  exchange_path: `${ROOT}/.exchange`,
  name: "space name",
  hooks: {},
  status: "ready",
  created_at: "2026-11-07T18:26:56Z",
  updated_at: "2026-11-07T18:30:00Z",
  freshness: "fetch",
  published: "deny",
  repositories: [
    {
      name: "app",
      source: "/home/dev/src/app",
      path: `${ROOT}/app`,
      state: `${ROOT}/.state/app`,
      branch: "feature/a",
      base: "main",
      remote_base: "origin/main",
      head_revision: "bd269991a1334afc419cfa9cd5ea98c4e166035f",
      ahead: 0,
      behind: 2,
      dirty: false,
      published: false,
      stale: true,
      refresh_result: "offline",
      refresh_reason: "remote fetch failed; used last known base",
      copy: {},
      dependencies: [
        {
          path: ".",
          manager: "pnpm",
          status: "missing",
          reason: "not installed yet",
        },
      ],
    },
  ],
  pending_repositories: [
    {
      name: "docs",
      source: "/home/dev/src/docs",
      branch: "feature/a",
      base: "main",
      error: "fetch origin failed",
      last_attempted_at: "2026-11-07T18:30:00Z",
    },
  ],
});

// `xwing env delete --dry-run -o json` before holds existed (capability epoch 16).
const epoch16DeletePreview = JSON.stringify({
  id: ID,
  number: 1,
  name: "space name",
  status: "ready",
  root: ROOT,
  worktrees: [],
  blockers: [],
  retained_paths: [],
  removed_worktrees: [],
  deleted: false,
});

it.layer(NodeServices.layer)("XwingOperations protocol", (it) => {
  it.effect.skipIf(windowsHost)(
    "starts apps without inheriting the server runtime environment",
    () =>
      Effect.gen(function* () {
        for (const key of [
          "T3CODE_PORT",
          "T3CODE_HOME",
          "VITE_DEV_SERVER_URL",
          "PORT",
          "ELECTRON_RUN_AS_NODE",
        ]) {
          vi.stubEnv(key, "server-only");
        }
        vi.stubEnv("XWING_APP_TEST_VALUE", "preserved");
        const { service } = yield* withFakeXwing([
          {
            script: `if env | grep -Eq '^(T3CODE_|VITE_|PORT=|ELECTRON_RUN_AS_NODE=)'; then
  echo 'error: T3CODE_PORT is managed by the application network; unset the conflicting environment override' >&2
  exit 1
fi
[ "$XWING_APP_TEST_VALUE" = preserved ] || exit 2
[ -n "$PATH" ] || exit 3`,
            out: '{"kind":"application_run","id":"run-fixture","name":"fixture","repo":"app","status":"running"}\n',
          },
        ]);
        expect(yield* service.startApp({ id: ID, repository: "app" })).toMatchObject([
          { status: "running" },
        ]);
      }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs()))),
  );

  it.effect.skipIf(windowsHost)("returns a bounded stderr tail when an app fails to start", () =>
    Effect.gen(function* () {
      const message =
        "error: T3CODE_PORT is managed by the application network; unset the conflicting environment override";
      const { service } = yield* withFakeXwing([
        { err: "x".repeat(3000) + "\n" + message + "\n", code: 1 },
      ]);
      const error = yield* Effect.flip(service.startApp({ id: ID, repository: "app" }));
      expect(error.message).toContain(message);
      if (!isOperationFailure(error)) return yield* error;
      const encoded = yield* encodeOperationFailure(error);
      expect(encoded).toMatchObject({ diagnostics: expect.stringContaining(message) });
      expect(error.message.length).toBeLessThan(2100);
    }),
  );

  it.effect.skipIf(windowsHost)("reads full pages of JSON-expanded application log records", () =>
    Effect.gen(function* () {
      const text = "\u0001".repeat(32 * 1024);
      const records = Array.from({ length: 100 }, (_, seq) => ({
        kind: "application_log",
        seq,
        time: "2026-11-07T18:00:00Z",
        stream: "stdout",
        text,
      }));
      const { service } = yield* withFakeXwing([
        {
          out:
            records.map((record) => JSON.stringify(record)).join("\n") +
            '\n{"kind":"log_summary","matched":100,"truncated":false}\n',
        },
      ]);
      const result = yield* service.readAppLogs({ id: ID, runId: "run-12345678" });
      expect(result.records).toHaveLength(100);
      expect(result.records.every((record) => record.text === text)).toBe(true);
      expect(result.truncated).toBe(false);
    }),
  );

  it.effect.skipIf(windowsHost)(
    "keeps the state repair printed before exiting nonzero, including stale and dependency warnings",
    () =>
      Effect.gen(function* () {
        const { service, argv } = yield* withFakeXwing([
          {
            out: `${partialRepairOutput}\n`,
            err: "error: refresh dependencies: install failed with token=hunter2\n",
            code: 1,
          },
        ]);

        const result = yield* service.repair({ id: ID });

        expect(yield* argv(1)).toEqual(["env", "repair", "--session", `id:${ID}`, "-o", "json"]);
        expect(result).toMatchObject({
          environmentId: ID,
          complete: false,
          exitCode: 1,
          repositories: [
            {
              name: "app",
              stale: true,
              behind: 2,
              refreshReason: "remote fetch failed; used last known base",
              dependencies: [{ path: ".", status: "missing", reason: "not installed yet" }],
            },
          ],
          pendingRepositories: [{ name: "docs", error: "fetch origin failed" }],
        });
      }),
  );

  it.effect.skipIf(windowsHost)(
    "reports a failed step with a category and the environment id, never Xwing's stderr",
    () =>
      Effect.gen(function* () {
        const { service } = yield* withFakeXwing([
          {
            err: 'error: base "nope" does not resolve in app; remote https://user:hunter2@example.com\n',
            code: 1,
          },
          { err: "error: something unexpected token=hunter2\n", code: 1 },
        ]);
        const attach = {
          id: ID,
          sourcePath: "/home/dev/src/app",
          branch: "feature/a",
        };

        const unresolved = yield* Effect.flip(
          service.attachRepository({ ...attach, base: "nope" }),
        );
        const unknown = yield* Effect.flip(service.repair({ id: ID }));

        expect(unresolved).toBeInstanceOf(XwingOperationFailedError);
        expect(unresolved).toMatchObject({
          operation: "attachRepository",
          category: "baseNotFound",
          environmentId: ID,
          exitCode: 1,
        });
        expect(unknown).toMatchObject({
          operation: "repair",
          category: "failed",
          exitCode: 1,
        });
        for (const error of [unresolved, unknown]) {
          expect(error.message).not.toContain("hunter2");
          if (!isOperationFailure(error)) return yield* error;
          expect(error.cause).toBeInstanceOf(Error);
          const encoded = yield* encodeOperationFailure(error);
          expect(JSON.stringify(encoded)).not.toContain("hunter2");
        }
      }),
  );

  it.effect.skipIf(windowsHost)("rejects invalid input without running Xwing", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* withFakeXwing([]);
      const attach = { id: ID, sourcePath: "/home/dev/src/app" };

      const rejected = [
        // Xwing derives a branch from a spaced session name that Git refuses.
        yield* Effect.flip(service.attachRepository({ ...attach, branch: "space name" })),
        yield* Effect.flip(service.attachRepository({ ...attach, branch: "--force" })),
        yield* Effect.flip(service.attachRepository({ ...attach, branch: "a..b" })),
        yield* Effect.flip(service.attachRepository({ ...attach, branch: "topic.lock" })),
        yield* Effect.flip(
          service.attachRepository({ ...attach, sourcePath: "app", branch: "feature/a" }),
        ),
        yield* Effect.flip(
          service.attachRepository({ ...attach, branch: "feature/a", base: "-x" }),
        ),
        yield* Effect.flip(
          service.registerHold({ id: ID, owner: "t3 thread", key: "k", label: "Thread" }),
        ),
        yield* Effect.flip(
          service.registerHold({ id: ID, owner: "t3", key: "k", label: "two\nlines" }),
        ),
        yield* Effect.flip(service.delete({ id: ID, confirmId: "5b560e939570086e" })),
        yield* Effect.flip(service.startApp({ id: ID, repository: "app", command: "Run Now" })),
        yield* Effect.flip(service.stopApp({ id: ID, runId: "web" })),
        yield* Effect.flip(service.create({ name: "  " })),
      ];

      for (const error of rejected) expect(error).toBeInstanceOf(XwingInvalidInputError);
      expect(yield* calls).toBe(0);
    }),
  );

  it.effect.skipIf(windowsHost)(
    "asks for an update when Xwing predates holds instead of trusting its cleanup",
    () =>
      Effect.gen(function* () {
        const { service } = yield* withFakeXwing([
          { out: "", err: 'error: unknown env command "hold"\n', code: 1 },
          { out: `${epoch16DeletePreview}\n` },
          { err: 'error: unknown flag "--sessions"\n', code: 1 },
          { err: 'error: unknown flag "--sessions"\n', code: 1 },
        ]);

        const errors = [
          yield* Effect.flip(service.listHolds({})),
          yield* Effect.flip(service.previewCleanup({ id: ID })),
          yield* Effect.flip(service.archive({ id: ID })),
          yield* Effect.flip(service.delete({ id: ID, confirmId: ID })),
        ];

        for (const error of errors) {
          expect(error).toBeInstanceOf(XwingOperationUnsupportedError);
          expect(error.message).toContain("Update Xwing");
        }
      }),
  );

  it.effect.skipIf(windowsHost)(
    "treats an unreadable hold list as a failure, not as no holds",
    () =>
      Effect.gen(function* () {
        const { service } = yield* withFakeXwing([
          { out: `{"kind":"hold","session_id":"${ID}","owner":"t3"}\n` },
          { err: "error: read holds: permission denied\n", code: 1 },
        ]);

        expect(yield* Effect.flip(service.listHolds({}))).toMatchObject({
          category: "unreadableOutput",
        });
        expect(yield* Effect.flip(service.listHolds({}))).toMatchObject({
          category: "failed",
        });
      }),
  );

  it.effect("reports Xwing as unavailable when the executable is missing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-xwing-missing-",
      });
      const service = yield* XwingOperations.make(path.join(directory, "xwing")).pipe(
        Effect.provide(ProcessRunner.layer),
      );

      expect(yield* Effect.flip(service.create({ name: "New work" }))).toBeInstanceOf(
        XwingUnavailableError,
      );
    }),
  );
});

// Runs only when the first `xwing` on PATH has environment holds (capability epoch 17), e.g.
// PATH=<xwing checkout>/bin:$PATH. Each test uses a private HOME and XWING_HOME.
const RealLayer = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));

const decodeInfo = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ capability_epoch: Schema.Number })),
);

const realXwing = await Effect.gen(function* () {
  if (windowsHost) return undefined;
  const runner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const found = yield* runner.run({ command: "sh", args: ["-c", "command -v xwing"] });
  const binary = found.stdout.trim();
  if (found.code !== 0 || !path.isAbsolute(binary)) return undefined;
  const scratch = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-xwing-probe-" });
  const info = yield* runner.run({
    command: binary,
    args: ["info", "-o", "json"],
    env: {
      HOME: scratch,
      XWING_HOME: path.join(scratch, "state"),
      XWING_CONFIG: path.join(scratch, "config.yaml"),
    },
  });
  const { capability_epoch } = yield* decodeInfo(info.stdout);
  return capability_epoch >= 17 ? binary : undefined;
}).pipe(
  Effect.scoped,
  Effect.orElseSucceed(() => undefined),
  Effect.provide(RealLayer),
  Effect.runPromise,
);

const APP_MANIFEST = `project: fixture
profiles: [local]
variables:
  PORT: { secret: false }
commands:
  run:
    argv: [sh, -c, 'echo started on $PORT; exec sleep 300']
  greet:
    argv: [sh, -c, 'echo hello; printf "\\377\\n" >&2']
app:
  ports:
    web: { preferred: 47123, env: PORT }
`;

const withRealXwing = Effect.fn("test.withRealXwing")(function* (binary: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const root = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3-xwing-real-",
  });
  const home = path.join(root, "home");
  yield* fileSystem.makeDirectory(home);
  yield* fileSystem.writeFileString(path.join(root, "config.yaml"), "repositories: {}\n");
  const isolated = path.join(root, "isolated");
  yield* fileSystem.writeFileString(
    isolated,
    `#!/bin/sh
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
export HOME='${home}' XDG_CONFIG_HOME='${home}/.config' GIT_CONFIG_NOSYSTEM=1
export XWING_HOME='${root}/state' XWING_CONFIG='${root}/config.yaml'
exec "$@"
`,
  );
  const command = path.join(root, "xwing");
  yield* fileSystem.writeFileString(command, `#!/bin/sh\nexec '${isolated}' '${binary}' "$@"\n`);
  yield* fileSystem.chmod(isolated, 0o755);
  yield* fileSystem.chmod(command, 0o755);

  const exec = (...args: ReadonlyArray<string>) =>
    runner
      .run({ command: isolated, args })
      .pipe(
        Effect.flatMap((output) =>
          output.code === 0
            ? Effect.succeed(output.stdout)
            : Effect.die(new Error(`${args.join(" ")}: ${output.stderr}`)),
        ),
      );
  const git = (repository: string, ...args: ReadonlyArray<string>) =>
    exec("git", "-C", repository, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args);

  const origin = path.join(root, "origin.git");
  const source = path.join(root, "source repo");
  yield* exec("git", "init", "-q", "--bare", "-b", "main", origin);
  yield* exec("git", "init", "-q", "-b", "main", source);
  yield* fileSystem.writeFileString(path.join(source, ".xwing-env.yaml"), APP_MANIFEST);
  yield* fileSystem.writeFileString(path.join(source, ".gitignore"), "ignored.txt\n");
  yield* git(source, "add", "-A");
  yield* git(source, "commit", "-qm", "init");
  yield* git(source, "remote", "add", "origin", origin);
  yield* git(source, "push", "-q", "origin", "main");

  const service = yield* XwingOperations.make(command);
  const catalog = yield* XwingEnvironments.make(command);
  // Registered after the temp directory so owned runs stop before it is removed.
  const stopAllAppsOnExit = (id: string) =>
    Effect.addFinalizer(() =>
      Effect.ignore(
        runner.run({
          command,
          args: ["app", "stop", "--all", "--session", `id:${id}`],
        }),
      ),
    );
  return { service, catalog, source, git, exec, command, stopAllAppsOnExit };
});

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(realXwing === undefined)("XwingOperations against a real Xwing", () => {
  const binary = realXwing ?? "";

  it.layer(RealLayer)("real", (it) => {
    it.effect(
      "keeps a created environment when an attach fails, then attaches and repairs it",
      () =>
        Effect.gen(function* () {
          const { service, catalog, source } = yield* withRealXwing(binary);

          const created = yield* service.create({ name: "Space name work" });
          const missing = yield* Effect.flip(
            service.attachRepository({
              id: created.id,
              sourcePath: `${source}-missing`,
              branch: "feature/one",
            }),
          );
          const defaultBranch = yield* Effect.flip(
            service.attachRepository({ id: created.id, sourcePath: source, branch: "main" }),
          );
          const attach = { id: created.id, sourcePath: source, branch: "feature/one" };
          const attached = yield* service.attachRepository(attach);
          const again = yield* service.attachRepository(attach);
          const repaired = yield* service.repair({ id: created.id });

          expect(created.name).toBe("Space name work");
          expect(missing).toMatchObject({
            category: "sourceNotFound",
            environmentId: created.id,
          });
          expect(defaultBranch).toMatchObject({
            category: "invalidBranch",
            environmentId: created.id,
          });
          expect(attached).toMatchObject({
            name: "source repo",
            branch: "feature/one",
            created: true,
            stale: false,
          });
          expect(again.created).toBe(false);
          expect(repaired).toMatchObject({
            complete: true,
            repositories: [{ name: "source repo", branch: "feature/one", stale: false }],
            pendingRepositories: [],
          });
          expect((yield* catalog.list()).map((environment) => environment.id)).toEqual([
            created.id,
          ]);
        }),
    );

    it.effect("holds an environment per owner until every owner releases it", () =>
      Effect.gen(function* () {
        const { service } = yield* withRealXwing(binary);
        const { id } = yield* service.create({ name: "Held work" });
        const hold = (owner: string, label = "Thread") =>
          service.registerHold({ id, owner, key: "thread:1", label });
        const release = (owner: string) => service.releaseHold({ id, owner, key: "thread:1" });

        const results = [
          (yield* hold("t3:one")).result,
          (yield* hold("t3:one")).result,
          (yield* hold("t3:one", "Renamed thread")).result,
          (yield* hold("t3:two")).result,
        ];
        const listed = yield* service.listHolds({ id });
        const byOwner = yield* service.listHolds({ owner: "t3:two" });
        const preview = yield* service.previewCleanup({ id });
        const heldByBoth = yield* Effect.flip(service.archive({ id }));
        yield* release("t3:one");
        const heldByOne = yield* Effect.flip(service.archive({ id }));
        const releasedLast = yield* release("t3:two");
        const archived = yield* service.archive({ id });
        const archivedAgain = yield* service.archive({ id });
        const releasedAgain = yield* release("t3:two");
        const onArchive = yield* hold("t3:one");

        expect(results).toEqual(["created", "unchanged", "updated", "created"]);
        expect(listed.map((held) => [held.owner, held.label, held.environmentStatus])).toEqual([
          ["t3:one", "Renamed thread", "active"],
          ["t3:two", "Thread", "active"],
        ]);
        expect(byOwner.map((held) => held.owner)).toEqual(["t3:two"]);
        expect(preview.deletable).toBe(false);
        expect(preview.holds.map((held) => held.owner)).toEqual(["t3:one", "t3:two"]);
        expect(heldByBoth).toMatchObject({ operation: "archive", category: "blocked" });
        expect(heldByOne).toMatchObject({ operation: "archive", category: "blocked" });
        expect(releasedLast.result).toBe("released");
        expect(archived.outcome).toBe("archived");
        expect(archivedAgain).toEqual({ ...archived, outcome: "alreadyArchived" });
        expect(releasedAgain).toMatchObject({ result: "absent", environmentStatus: "archived" });
        expect(onArchive.hold.environmentStatus).toBe("archived");
        yield* release("t3:one");
        expect((yield* service.restore({ id })).outcome).toBe("restored");
        expect((yield* service.restore({ id })).outcome).toBe("alreadyActive");
      }),
    );

    it.effect("refuses to delete unsaved work and deletes only a clean environment", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { service, catalog, source, git } = yield* withRealXwing(binary);
        const dirty = yield* service.create({ name: "Dirty work" });
        const clean = yield* service.create({ name: "Clean work" });
        const { path: worktree } = yield* service.attachRepository({
          id: dirty.id,
          sourcePath: source,
          branch: "feature/dirty",
        });
        yield* fileSystem.writeFileString(path.join(worktree, "README"), "changed");
        yield* git(worktree, "add", "README");
        yield* fileSystem.writeFileString(path.join(worktree, "untracked.txt"), "new");
        yield* fileSystem.writeFileString(path.join(worktree, "ignored.txt"), "local");

        const preview = yield* service.previewCleanup({ id: dirty.id });
        const refused = yield* Effect.flip(service.delete({ id: dirty.id, confirmId: dirty.id }));
        const deleted = yield* service.delete({ id: clean.id, confirmId: clean.id });
        const deletedAgain = yield* service.delete({ id: clean.id, confirmId: clean.id });

        expect(preview).toMatchObject({
          deletable: false,
          worktrees: [{ name: "source repo", dirty: true, untracked: true, ignored: true }],
        });
        expect(preview.blockers.length).toBeGreaterThan(0);
        expect(preview.retainedPaths).toContain(source);
        expect(refused).toMatchObject({
          operation: "delete",
          category: "blocked",
          environmentId: dirty.id,
          blockers: preview.blockers,
        });
        expect(deleted.outcome).toBe("deleted");
        expect(deletedAgain.outcome).toBe("absent");
        expect((yield* catalog.list()).map((environment) => environment.id)).toEqual([dirty.id]);
      }),
    );

    it.effect("starts owned background runs, reads their bounded logs and stops them", () =>
      Effect.gen(function* () {
        const { service, source, command, exec, stopAllAppsOnExit } = yield* withRealXwing(binary);
        const { id } = yield* service.create({ name: "App work" });
        yield* stopAllAppsOnExit(id);
        yield* service.attachRepository({ id, sourcePath: source, branch: "feature/app" });
        const repository = "source repo";

        expect(yield* service.listAppCommands({ id, repository })).toEqual([
          { name: "greet", description: undefined },
          { name: "run", description: undefined },
        ]);
        const [app] = yield* service.startApp({ id, repository });
        const [greet] = yield* service.startApp({ id, repository, command: "greet" });
        // Following returns once the run has ended and its output is captured.
        yield* exec(
          command,
          "app",
          "logs",
          "--session",
          `id:${id}`,
          "--run",
          greet!.id,
          "--follow",
        );
        const tail = yield* service.readAppLogs({ id, runId: greet!.id, limit: 1 });
        const all = yield* service.readAppLogs({ id, runId: greet!.id });
        const stderr = yield* service.readAppLogs({ id, runId: greet!.id, stream: "stderr" });
        const stopped = yield* service.stopApp({ id, runId: app!.id });
        const stoppedAgain = yield* service.stopApp({ id, runId: app!.id });
        const undeclared = yield* Effect.flip(
          service.startApp({ id, repository, command: "deploy" }),
        );
        const unknownRun = yield* Effect.flip(
          service.stopApp({ id, runId: "run-0123456789abcdef" }),
        );

        expect(app).toMatchObject({
          name: "fixture",
          repository,
          status: "running",
          urls: { web: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) },
        });
        expect(tail).toMatchObject({ matched: 2, truncated: true });
        expect(tail.records).toHaveLength(1);
        // stdout and stderr are captured separately, so their relative order varies.
        expect(all.truncated).toBe(false);
        expect(
          all.records.map((record) => [record.stream, record.text, record.binary]).toSorted(),
        ).toEqual([
          ["stderr", "\uFFFD\n", true],
          ["stdout", "hello\n", false],
        ]);
        expect(stderr.records.map((record) => record.text)).toEqual(["\uFFFD\n"]);
        expect(stopped).toMatchObject({ id: app!.id, status: "stopped" });
        expect(stoppedAgain.status).toBe("stopped");
        expect(isAlive(app!.pid!)).toBe(false);
        expect(undeclared).toMatchObject({ category: "commandNotDeclared" });
        expect(unknownRun).toMatchObject({ category: "runNotFound" });
      }),
    );
  });
});
