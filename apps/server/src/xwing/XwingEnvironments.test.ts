import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  XwingCommandError,
  XwingEnvironmentId,
  XwingEnvironmentNotFoundError,
  XwingOutputError,
  XwingUnavailableError,
  XwingUnsupportedError,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import * as XwingEnvironments from "./XwingEnvironments.ts";

// The fake executable is a POSIX shell script.
const windowsHost = HostProcess.Platform.defaultValue() === "win32";
const ID = "18904777e18fcea5";
const ROOT = "/home/dev/.xwing/envs/1";

const ARCHIVED_ID = "5b560e939570086e";
const EMPTY_ID = "b3fec29651da45fb";

// Shape captured from `xwing env list --sessions -o json` (capability epoch 17) against an
// isolated XWING_HOME, with paths shortened.
const catalogOutput = (checkouts: string) =>
  [
    {
      kind: "environment",
      id: ID,
      number: 1,
      name: "space name",
      ticket: "BW-1",
      status: "active",
      path: ROOT,
      created_at: "2026-11-07T17:58:05Z",
      updated_at: "2026-11-07T17:58:05Z",
      repositories: [
        {
          name: "my repo",
          source: "/home/dev/src/my repo",
          path: `${checkouts}/my repo`,
          branch: "feature/spaces",
        },
        {
          name: "docs",
          source: "/home/dev/src/docs",
          path: `${checkouts}/docs`,
          branch: "feature/spaces",
        },
      ],
    },
    {
      kind: "environment",
      id: EMPTY_ID,
      number: 2,
      name: "",
      status: "active",
      path: "/home/dev/.xwing/envs/2",
      created_at: "2026-11-07T17:58:05Z",
      updated_at: "2026-11-07T17:58:05Z",
      repositories: [],
    },
    {
      kind: "environment",
      id: ARCHIVED_ID,
      number: 0,
      name: "to archive",
      status: "archived",
      path: `/home/dev/.xwing/archives/${ARCHIVED_ID}`,
      created_at: "2026-11-07T17:58:05Z",
      updated_at: "2026-11-07T17:58:06Z",
      archived_at: "2026-11-07T17:58:06Z",
      repositories: [
        {
          name: "my repo",
          source: "/home/dev/src/my repo",
          path: checkouts,
          branch: "feature/b",
        },
      ],
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n");

const contextOutput = JSON.stringify({
  candidate_tools: {
    installers: [],
    inspect: ["xwing", "tool", "list", "--session", "1"],
  },
  candidates: [],
  session: {
    version: 2,
    id: ID,
    number: 1,
    path: ROOT,
    exchange_path: `${ROOT}/.exchange`,
    name: "space name",
    hooks: {},
    status: "ready",
    lifecycle: {
      action: "archive",
      since: "2026-11-07T16:48:53Z",
      due_at: "2026-11-09T16:48:53Z",
      due: false,
    },
    created_at: "2026-11-07T16:48:35Z",
    updated_at: "2026-11-07T16:48:53Z",
    freshness: "fetch",
    published: "deny",
    repositories: [
      {
        name: "my repo",
        source: "/home/dev/src/my repo",
        path: `${ROOT}/my repo`,
        state: `${ROOT}/.state/my repo`,
        branch: "feature/spaces",
        base: "main",
        base_revision: "c21afc73795e173843b9756d5fa97e5d8e80fe47",
        head_revision: "c21afc73795e173843b9756d5fa97e5d8e80fe47",
        ahead: 0,
        behind: 0,
        dirty: true,
        published: false,
        stale: true,
        refresh_result: "offline-created",
        refresh_reason: "remote fetch failed; used last known base",
        copy: {},
      },
    ],
  },
  health: {
    status: "attention",
    environment: ID,
    number: 1,
    dirty: 1,
    checks: [
      {
        status: "attention",
        code: "worktree.dirty",
        repository: "my repo",
        message: "uncommitted changes",
      },
      { status: "ok", code: "repositories.pending", message: "none" },
    ],
  },
  links: null,
  recent_events: [],
  agent_sessions: null,
});

const applicationsOutput = [
  {
    kind: "application_run",
    id: "run-5e80",
    name: "web",
    repo: "my repo",
    status: "running",
    pid: 4242,
    started_at: "2026-11-07T16:50:00Z",
    urls: { web: "http://127.0.0.1:3202" },
  },
  {
    kind: "application_run",
    id: "run-dccf",
    name: "api",
    repo: "my repo",
    status: "exited",
    exit_code: 1,
  },
  {
    kind: "page",
    total: 41,
    returned: 40,
    truncated: true,
    hint: "increase --limit",
  },
]
  .map((entry) => JSON.stringify(entry))
  .join("\n");

// Stands in for xwing: replays the files beside it and records each call's argv.
const FAKE_XWING = `#!/bin/sh
here=$(dirname "$0")
for arg in "$@"; do printf '%s\\n' "$arg"; done > "$here/argv-$1-$2"
printf '%s' "$CLAUDE_CODE_SESSION_ID" > "$here/agent"
if [ -f "$here/$1-$2.err" ]; then cat "$here/$1-$2.err" >&2; fi
if [ ! -f "$here/$1-$2.out" ]; then
  echo "error: session \\"$4\\" not found" >&2
  exit 1
fi
cat "$here/$1-$2.out"
exit "$(cat "$here/$1-$2.code" 2>/dev/null || echo 0)"
`;

const withFakeXwing = Effect.fn("test.withFakeXwing")(function* (
  outputs: Readonly<Record<string, string>>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-xwing-" }),
    "bin with spaces",
  );
  yield* fileSystem.makeDirectory(directory);
  const command = path.join(directory, "xwing");
  yield* fileSystem.writeFileString(command, FAKE_XWING);
  yield* fileSystem.chmod(command, 0o755);
  for (const [name, content] of Object.entries(outputs)) {
    yield* fileSystem.writeFileString(path.join(directory, name), content);
  }
  const service = yield* XwingEnvironments.make(command).pipe(Effect.provide(ProcessRunner.layer));
  const read = (name: string) => fileSystem.readFileString(path.join(directory, name));
  return { service, read };
});

const id = (value: string) => XwingEnvironmentId.make(value);

it.layer(NodeServices.layer)("XwingEnvironments", (it) => {
  it.effect.skipIf(windowsHost)(
    "lists active, empty and archived environments from the catalog with checkout presence",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const checkouts = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-xwing-co-" });
        yield* fileSystem.makeDirectory(path.join(checkouts, "my repo"));
        const { service, read } = yield* withFakeXwing({
          "env-list.out": `${catalogOutput(checkouts)}\n`,
        });

        const environments = yield* service.list();

        expect(yield* read("argv-env-list")).toBe("env\nlist\n--sessions\n-o\njson\n");
        expect(yield* read("agent")).toBe("");
        expect(environments).toEqual([
          {
            id: ID,
            number: 1,
            name: "space name",
            ticket: "BW-1",
            status: "active",
            rootPath: ROOT,
            createdAt: "2026-11-07T17:58:05Z",
            updatedAt: "2026-11-07T17:58:05Z",
            archivedAt: undefined,
            repositories: [
              {
                name: "my repo",
                sourcePath: "/home/dev/src/my repo",
                path: `${checkouts}/my repo`,
                branch: "feature/spaces",
                present: true,
              },
              {
                name: "docs",
                sourcePath: "/home/dev/src/docs",
                path: `${checkouts}/docs`,
                branch: "feature/spaces",
                present: false,
              },
            ],
          },
          {
            id: EMPTY_ID,
            number: 2,
            name: EMPTY_ID,
            ticket: undefined,
            status: "active",
            rootPath: "/home/dev/.xwing/envs/2",
            createdAt: "2026-11-07T17:58:05Z",
            updatedAt: "2026-11-07T17:58:05Z",
            archivedAt: undefined,
            repositories: [],
          },
          {
            id: ARCHIVED_ID,
            number: undefined,
            name: "to archive",
            ticket: undefined,
            status: "archived",
            rootPath: `/home/dev/.xwing/archives/${ARCHIVED_ID}`,
            createdAt: "2026-11-07T17:58:05Z",
            updatedAt: "2026-11-07T17:58:06Z",
            archivedAt: "2026-11-07T17:58:06Z",
            // The archived copy exists on disk but is never offered as a checkout.
            repositories: [
              {
                name: "my repo",
                sourcePath: "/home/dev/src/my repo",
                path: checkouts,
                branch: "feature/b",
                present: false,
              },
            ],
          },
        ]);
      }),
  );

  it.effect.skipIf(windowsHost)("lists nothing when Xwing has no environments", () =>
    Effect.gen(function* () {
      const { service } = yield* withFakeXwing({ "env-list.out": "" });
      expect(yield* service.list()).toEqual([]);
    }),
  );

  it.effect.skipIf(windowsHost)("asks for an update when Xwing predates the catalog", () =>
    Effect.gen(function* () {
      const { service } = yield* withFakeXwing({
        "env-list.out": "",
        "env-list.err": 'error: unknown flag "--sessions"\n',
        "env-list.code": "1",
      });
      const error = yield* Effect.flip(service.list());
      expect(error).toBeInstanceOf(XwingUnsupportedError);
      expect(error.message).toContain("Update Xwing");
    }),
  );

  it.effect.skipIf(windowsHost)(
    "inspects one environment without attributing the read to an agent",
    () =>
      Effect.gen(function* () {
        const { service, read } = yield* withFakeXwing({
          "env-context.out": contextOutput,
          "app-list.out": applicationsOutput,
        });

        const detail = yield* service.inspect(id(ID));

        expect(yield* read("argv-env-context")).toBe(`env\ncontext\n--session\n${ID}\n-o\njson\n`);
        expect(yield* read("argv-app-list")).toBe(`app\nlist\n--session\n${ID}\n-o\njson\n`);
        expect(yield* read("agent")).toBe("");
        expect(detail).toMatchObject({
          id: ID,
          number: 1,
          name: "space name",
          rootPath: ROOT,
          status: "ready",
          lifecycle: {
            action: "archive",
            dueAt: "2026-11-09T16:48:53Z",
            due: false,
          },
          repositories: [
            {
              name: "my repo",
              sourcePath: "/home/dev/src/my repo",
              path: `${ROOT}/my repo`,
              dirty: true,
              stale: true,
              refreshResult: "offline-created",
            },
          ],
          health: {
            status: "attention",
            checks: [
              { code: "worktree.dirty", repository: "my repo" },
              { code: "repositories.pending", repository: undefined },
            ],
          },
          agentSessions: [],
        });
        expect(detail.applications).toEqual({
          truncated: true,
          runs: [
            {
              id: "run-5e80",
              name: "web",
              repository: "my repo",
              status: "running",
              pid: 4242,
              exitCode: undefined,
              startedAt: "2026-11-07T16:50:00Z",
              urls: { web: "http://127.0.0.1:3202" },
            },
            {
              id: "run-dccf",
              name: "api",
              repository: "my repo",
              status: "exited",
              pid: undefined,
              exitCode: 1,
              startedAt: undefined,
              urls: {},
            },
          ],
        });
      }),
  );

  it.effect.skipIf(windowsHost)("reports an environment Xwing no longer has as not found", () =>
    Effect.gen(function* () {
      const { service } = yield* withFakeXwing({});
      const error = yield* Effect.flip(service.inspect(id("ffffffffffffffff")));
      expect(error).toBeInstanceOf(XwingEnvironmentNotFoundError);
    }),
  );

  it.effect.skipIf(windowsHost)("rejects the whole catalog when any line is unreadable", () =>
    Effect.gen(function* () {
      const [first, second] = catalogOutput("/x").split("\n");
      for (const [stdout, line] of [
        // Old worktree rows must not pass as a catalog.
        [`${first}\n{"path":"/x","repo":"x","branch":"b","session_id":"${ID}","stale":false}\n`, 2],
        [`${first}\n${second?.replace('"active"', '"paused"')}\n`, 2],
        [`${first}\n${first?.slice(0, 40)}\n`, 2],
      ] as const) {
        const { service } = yield* withFakeXwing({ "env-list.out": stdout });
        const error = yield* Effect.flip(service.list());
        expect(error).toBeInstanceOf(XwingOutputError);
        expect(error).toMatchObject({ operation: "list", line });
      }
    }),
  );

  it.effect.skipIf(windowsHost)("keeps a failed command's exit code", () =>
    Effect.gen(function* () {
      const { service } = yield* withFakeXwing({
        "env-list.out": "",
        "env-list.code": "3",
      });
      const error = yield* Effect.flip(service.list());
      expect(error).toBeInstanceOf(XwingCommandError);
      expect(error).toMatchObject({ operation: "list", exitCode: 3 });
    }),
  );

  it.effect.skipIf(windowsHost)("fails inspection when the app list fails", () =>
    Effect.gen(function* () {
      const { service } = yield* withFakeXwing({
        "env-context.out": contextOutput,
        "app-list.out": "",
        "app-list.err": "error: app state unreadable\n",
        "app-list.code": "2",
      });
      const error = yield* Effect.flip(service.inspect(id(ID)));
      expect(error).toBeInstanceOf(XwingCommandError);
      expect(error).toMatchObject({ operation: "listApplications", exitCode: 2 });
    }),
  );

  it.effect("reports Xwing as unavailable when the executable is missing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-xwing-missing-",
      });
      const service = yield* XwingEnvironments.make(path.join(directory, "no xwing here")).pipe(
        Effect.provide(ProcessRunner.layer),
      );

      const error = yield* Effect.flip(service.list());

      expect(error).toBeInstanceOf(XwingUnavailableError);
    }),
  );
});
