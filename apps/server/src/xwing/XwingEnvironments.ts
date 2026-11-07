import {
  XwingCommandError,
  type XwingApplicationRun,
  type XwingEnvironmentDetail,
  XwingEnvironmentId,
  XwingEnvironmentNotFoundError,
  type XwingEnvironmentSummary,
  type XwingInspectError,
  type XwingListError,
  type XwingOperation,
  XwingOutputError,
  XwingUnavailableError,
  XwingUnsupportedError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

// Wire shapes mirror Xwing's Go JSON tags; omitempty fields are optional.
const CatalogEntry = Schema.Struct({
  kind: Schema.Literal("environment"),
  id: XwingEnvironmentId,
  number: Schema.Number,
  name: Schema.String,
  ticket: Schema.optional(Schema.String),
  status: Schema.Literals(["active", "archived"]),
  path: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  archived_at: Schema.optional(Schema.String),
  repositories: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      source: Schema.String,
      path: Schema.String,
      branch: Schema.String,
    }),
  ),
});

const RepositoryState = Schema.Struct({
  name: Schema.String,
  source: Schema.String,
  path: Schema.String,
  branch: Schema.String,
  base: Schema.String,
  head_revision: Schema.optional(Schema.String),
  ahead: Schema.Number,
  behind: Schema.Number,
  dirty: Schema.Boolean,
  published: Schema.Boolean,
  stale: Schema.Boolean,
  refresh_result: Schema.optional(Schema.String),
  refresh_reason: Schema.optional(Schema.String),
});

const HealthCheck = Schema.Struct({
  status: Schema.String,
  code: Schema.String,
  repository: Schema.optional(Schema.String),
  message: Schema.String,
});

const AgentSession = Schema.Struct({
  harness: Schema.String,
  session: Schema.optional(Schema.String),
  first_seen: Schema.String,
  last_seen: Schema.String,
});

const ContextOutput = Schema.Struct({
  session: Schema.Struct({
    id: XwingEnvironmentId,
    number: Schema.optional(Schema.Number),
    path: Schema.String,
    name: Schema.optional(Schema.String),
    ticket: Schema.optional(Schema.String),
    status: Schema.optional(Schema.String),
    lifecycle: Schema.optional(
      Schema.Struct({
        action: Schema.String,
        due_at: Schema.optional(Schema.String),
        due: Schema.Boolean,
        blocked: Schema.optional(Schema.String),
      }),
    ),
    created_at: Schema.String,
    updated_at: Schema.String,
    repositories: Schema.NullOr(Schema.Array(RepositoryState)),
  }),
  health: Schema.Struct({
    status: Schema.String,
    checks: Schema.optional(Schema.NullOr(Schema.Array(HealthCheck))),
  }),
  agent_sessions: Schema.NullOr(Schema.Array(AgentSession)),
});

const ApplicationsLine = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("application_run"),
    id: Schema.String,
    name: Schema.String,
    repo: Schema.String,
    status: Schema.String,
    pid: Schema.optional(Schema.Number),
    exit_code: Schema.optional(Schema.Number),
    started_at: Schema.optional(Schema.String),
    urls: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
  Schema.Struct({ kind: Schema.Literal("page"), truncated: Schema.Boolean }),
]);

/**
 * Read-only view of this machine's Xwing development environments. `list` is
 * Xwing's complete catalog of active and archived environments, read without
 * Git calls; `inspect` asks Xwing for one active environment's live Git state,
 * health and app runs, so call it on demand.
 */
export class XwingEnvironments extends Context.Service<
  XwingEnvironments,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<XwingEnvironmentSummary>, XwingListError>;
    readonly inspect: (
      id: XwingEnvironmentId,
    ) => Effect.Effect<XwingEnvironmentDetail, XwingInspectError>;
  }
>()("t3/xwing/XwingEnvironments") {}

// Xwing records an agent session against an environment whenever these are set,
// which would attribute server reads to whichever agent launched the server.
export const WITHOUT_AGENT_IDENTITY = {
  CLAUDE_CODE_SESSION_ID: "",
  CODEX_THREAD_ID: "",
  CODEX_SESSION_ID: "",
  AI_AGENT: "",
};

const decodeCatalogEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(CatalogEntry));
const decodeContext = Schema.decodeUnknownEffect(Schema.fromJsonString(ContextOutput));
const decodeApplicationsLine = Schema.decodeUnknownEffect(Schema.fromJsonString(ApplicationsLine));

// How Xwing before capability epoch 17 rejects the catalog flag.
const UNSUPPORTED_SESSIONS_FLAG = /unknown flag "--sessions"/;

const decodeNdjson = <A>(
  operation: XwingOperation,
  decode: (text: string) => Effect.Effect<A, Schema.SchemaError>,
  stdout: string,
) =>
  Effect.forEach(
    stdout.split("\n").flatMap((text, index) => (text.trim() === "" ? [] : [{ text, index }])),
    ({ text, index }) =>
      decode(text).pipe(
        Effect.mapError((cause) => new XwingOutputError({ operation, line: index + 1, cause })),
      ),
  );

const toDetail = (
  context: typeof ContextOutput.Type,
  applications: ReadonlyArray<typeof ApplicationsLine.Type>,
): XwingEnvironmentDetail => {
  const { session } = context;
  const runs: XwingApplicationRun[] = [];
  let truncated = false;
  for (const line of applications) {
    if (line.kind === "page") {
      truncated ||= line.truncated;
      continue;
    }
    runs.push({
      id: line.id,
      name: line.name,
      repository: line.repo,
      status: line.status,
      pid: line.pid,
      exitCode: line.exit_code,
      startedAt: line.started_at,
      urls: line.urls ?? {},
    });
  }
  return {
    id: session.id,
    number: session.number,
    name: session.name ?? session.id,
    ticket: session.ticket,
    rootPath: session.path,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    lifecycle: session.lifecycle && {
      action: session.lifecycle.action,
      dueAt: session.lifecycle.due_at,
      due: session.lifecycle.due,
      blocked: session.lifecycle.blocked,
    },
    repositories: (session.repositories ?? []).map((repository) => ({
      name: repository.name,
      sourcePath: repository.source,
      path: repository.path,
      branch: repository.branch,
      base: repository.base,
      headRevision: repository.head_revision,
      ahead: repository.ahead,
      behind: repository.behind,
      dirty: repository.dirty,
      published: repository.published,
      stale: repository.stale,
      refreshResult: repository.refresh_result,
      refreshReason: repository.refresh_reason,
    })),
    health: {
      status: context.health.status,
      checks: (context.health.checks ?? []).map((check) => ({
        status: check.status,
        code: check.code,
        repository: check.repository,
        message: check.message,
      })),
    },
    applications: { runs, truncated },
    agentSessions: (context.agent_sessions ?? []).map((agent) => ({
      harness: agent.harness,
      session: agent.session,
      firstSeen: agent.first_seen,
      lastSeen: agent.last_seen,
    })),
  };
};

/** Builds the service around an Xwing executable name or path. */
export const make = Effect.fn("XwingEnvironments.make")(function* (command = "xwing") {
  const runner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;

  const isDirectory = (path: string) =>
    fileSystem.stat(path).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  const summarize = (entry: typeof CatalogEntry.Type) =>
    Effect.forEach(
      entry.repositories,
      (repository) =>
        Effect.map(
          entry.status === "active" ? isDirectory(repository.path) : Effect.succeed(false),
          (present) => ({
            name: repository.name,
            sourcePath: repository.source,
            path: repository.path,
            branch: repository.branch,
            present,
          }),
        ),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map((repositories): XwingEnvironmentSummary => ({
        id: entry.id,
        // Xwing prints 0 for older environments kept outside ~/.xwing/envs.
        number: entry.number > 0 ? entry.number : undefined,
        name: entry.name === "" ? entry.id : entry.name,
        ticket: entry.ticket,
        status: entry.status,
        rootPath: entry.path,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
        archivedAt: entry.archived_at,
        repositories,
      })),
    );

  const run = (operation: XwingOperation, args: ReadonlyArray<string>) =>
    runner
      .run({ command, args, env: WITHOUT_AGENT_IDENTITY })
      .pipe(
        Effect.mapError((cause) =>
          cause._tag === "ProcessSpawnError"
            ? new XwingUnavailableError({ command, cause })
            : new XwingCommandError({ operation, exitCode: null, cause }),
        ),
      );

  const exitFailure = (operation: XwingOperation, output: ProcessRunner.ProcessRunOutput) =>
    new XwingCommandError({
      operation,
      exitCode: output.code,
      cause: new Error(output.stderr.trim().slice(-2_000)),
    });

  const list = Effect.fn("XwingEnvironments.list")(function* () {
    const output = yield* run("list", ["env", "list", "--sessions", "-o", "json"]);
    if (output.code !== 0) {
      return yield* UNSUPPORTED_SESSIONS_FLAG.test(output.stderr)
        ? new XwingUnsupportedError({
            command,
            cause: new Error(output.stderr.trim()),
          })
        : exitFailure("list", output);
    }
    const entries = yield* decodeNdjson("list", decodeCatalogEntry, output.stdout);
    return yield* Effect.forEach(entries, summarize, {
      concurrency: "unbounded",
    });
  });

  const inspect = Effect.fn("XwingEnvironments.inspect")(function* (id: XwingEnvironmentId) {
    yield* Effect.annotateCurrentSpan("xwing.environment", id);
    const session = ["--session", id, "-o", "json"];
    const [context, applications] = yield* Effect.all(
      [
        run("inspect", ["env", "context", ...session]),
        run("listApplications", ["app", "list", ...session]),
      ],
      { concurrency: 2 },
    );
    for (const [operation, output] of [
      ["inspect", context],
      ["listApplications", applications],
    ] as const) {
      if (output.code === 0) continue;
      return yield* output.stderr.includes(`session "${id}" not found`)
        ? new XwingEnvironmentNotFoundError({ environmentId: id })
        : exitFailure(operation, output);
    }
    const decoded = yield* decodeContext(context.stdout).pipe(
      Effect.mapError((cause) => new XwingOutputError({ operation: "inspect", line: 1, cause })),
    );
    return toDetail(
      decoded,
      yield* decodeNdjson("listApplications", decodeApplicationsLine, applications.stdout),
    );
  });

  return XwingEnvironments.of({ list, inspect });
});

export const layer = Layer.effect(XwingEnvironments, make());
