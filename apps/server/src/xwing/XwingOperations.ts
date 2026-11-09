import {
  type XwingApplicationRun,
  type XwingArchiveResult,
  type XwingRestoreResult,
  type XwingAttachedRepository,
  XwingAttachRepositoryInput,
  type XwingCleanupPreview,
  XwingCreateInput,
  type XwingCreatedEnvironment,
  XwingDeleteInput,
  type XwingDeleteResult,
  type XwingDependencyState,
  XwingEnvironmentId,
  XwingEnvironmentInput,
  type XwingFailureCategory,
  XwingHoldEnvironmentStatus,
  XwingInvalidInputError,
  type XwingListedHold,
  XwingListHoldsInput,
  type XwingAppLogs,
  type XwingOperationError,
  XwingOperationFailedError,
  type XwingOperationName,
  XwingOperationUnsupportedError,
  XwingReadAppLogsInput,
  type XwingAppCommand,
  XwingListAppCommandsInput,
  XwingRegisterHoldInput,
  type XwingRegisterHoldResult,
  XwingReleaseHoldInput,
  type XwingReleaseHoldResult,
  type XwingRepairResult,
  XwingStartAppInput,
  XwingStopAppInput,
  XwingUnavailableError,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isServerRuntimeEnvKey } from "../runtimeEnvironment.ts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import { WITHOUT_AGENT_IDENTITY } from "./XwingEnvironments.ts";

// Wire shapes mirror Xwing's Go JSON tags (capability epoch 17); omitempty fields are optional.
const DependencyWire = Schema.Struct({
  path: Schema.String,
  manager: Schema.optional(Schema.String),
  status: Schema.String,
  reason: Schema.optional(Schema.String),
});

const CreateWire = Schema.Struct({
  session: Schema.Struct({
    id: XwingEnvironmentId,
    number: Schema.optional(Schema.Number),
    name: Schema.optional(Schema.String),
    path: Schema.String,
    created_at: Schema.String,
  }),
});

const AddWire = Schema.Struct({
  path: Schema.String,
  repo: Schema.String,
  branch: Schema.String,
  created: Schema.Boolean,
  stale: Schema.Boolean,
  base_revision: Schema.optional(Schema.String),
  refresh_result: Schema.optional(Schema.String),
  refresh_reason: Schema.optional(Schema.String),
  dependencies: Schema.optional(Schema.Array(DependencyWire)),
  dependency_warnings: Schema.optional(Schema.Array(Schema.String)),
});

const SessionWire = Schema.Struct({
  id: XwingEnvironmentId,
  status: Schema.optional(Schema.String),
  repositories: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
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
        dependencies: Schema.optional(Schema.Array(DependencyWire)),
      }),
    ),
  ),
  pending_repositories: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        source: Schema.String,
        branch: Schema.String,
        base: Schema.optional(Schema.String),
        error: Schema.String,
        last_attempted_at: Schema.String,
      }),
    ),
  ),
});

const HoldCoreFields = {
  session_id: XwingEnvironmentId,
  owner: Schema.String,
  key: Schema.String,
  label: Schema.String,
  detail: Schema.optional(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
};

const HoldWire = Schema.Struct({
  kind: Schema.Literal("hold"),
  ...HoldCoreFields,
  number: Schema.optional(Schema.Number),
  name: Schema.optional(Schema.String),
  status: XwingHoldEnvironmentStatus,
  result: Schema.optional(Schema.String),
});

const RegisteredHoldWire = HoldWire.mapFields((fields) => ({
  ...fields,
  result: Schema.Literals(["created", "updated", "unchanged"]),
}));
const ReleasedHoldWire = HoldWire.mapFields((fields) => ({
  ...fields,
  result: Schema.Literals(["released", "absent"]),
}));

const DeleteReportWire = Schema.Struct({
  id: XwingEnvironmentId,
  number: Schema.Number,
  name: Schema.String,
  status: Schema.String,
  root: Schema.String,
  worktrees: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      path: Schema.String,
      dirty: Schema.Boolean,
      untracked: Schema.Boolean,
      ignored: Schema.Boolean,
    }),
  ),
  blockers: Schema.Array(Schema.String),
  // Absent before capability epoch 17, which also ignored holds.
  holds: Schema.optional(Schema.Array(Schema.Struct(HoldCoreFields))),
  retained_paths: Schema.Array(Schema.String),
  removed_worktrees: Schema.Array(Schema.String),
  deleted: Schema.Boolean,
  apps: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          status: Schema.String,
        }),
      ),
    ),
  ),
});

const CatalogWire = Schema.Struct({
  kind: Schema.Literal("environment"),
  id: XwingEnvironmentId,
  status: Schema.Literals(["active", "archived"]),
  path: Schema.String,
});

const CommandWire = Schema.Struct({
  kind: Schema.Literal("command"),
  name: Schema.String,
  description: Schema.optional(Schema.String),
});
const CommandSummaryWire = Schema.Struct({ kind: Schema.Literal("command-summary") });

const ArchiveWire = Schema.Struct({
  kind: Schema.Literal("environment"),
  id: XwingEnvironmentId,
  status: Schema.Literal("archived"),
  path: Schema.String,
});

const RunWire = Schema.Struct({
  kind: Schema.Literal("application_run"),
  id: Schema.String,
  name: Schema.String,
  repo: Schema.String,
  status: Schema.String,
  pid: Schema.optional(Schema.Number),
  exit_code: Schema.optional(Schema.Number),
  started_at: Schema.optional(Schema.String),
  urls: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const LogLineWire = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("application_log"),
    seq: Schema.Number,
    time: Schema.String,
    stream: Schema.Literals(["stdout", "stderr"]),
    text: Schema.optional(Schema.String),
    encoding: Schema.optional(Schema.Literal("base64")),
    data: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("log_summary"),
    matched: Schema.Number,
    truncated: Schema.Boolean,
  }),
]);

/**
 * Changes Xwing environments through its CLI. Setup never rolls back: `create`
 * returns the id and later steps report partial state. `archive` and `delete`
 * are for a cleanup coordinator that already checked its own work and took a
 * fresh `previewCleanup`; nothing here serializes lifecycle changes.
 */
export class XwingOperations extends Context.Service<
  XwingOperations,
  {
    readonly create: (
      input: XwingCreateInput,
    ) => Effect.Effect<XwingCreatedEnvironment, XwingOperationError>;
    readonly attachRepository: (
      input: XwingAttachRepositoryInput,
    ) => Effect.Effect<XwingAttachedRepository, XwingOperationError>;
    readonly repair: (
      input: XwingEnvironmentInput,
    ) => Effect.Effect<XwingRepairResult, XwingOperationError>;
    readonly registerHold: (
      input: XwingRegisterHoldInput,
    ) => Effect.Effect<XwingRegisterHoldResult, XwingOperationError>;
    readonly releaseHold: (
      input: XwingReleaseHoldInput,
    ) => Effect.Effect<XwingReleaseHoldResult, XwingOperationError>;
    readonly listHolds: (
      input: XwingListHoldsInput,
    ) => Effect.Effect<ReadonlyArray<XwingListedHold>, XwingOperationError>;
    readonly previewCleanup: (
      input: XwingEnvironmentInput,
    ) => Effect.Effect<XwingCleanupPreview, XwingOperationError>;
    readonly archive: (
      input: XwingEnvironmentInput,
    ) => Effect.Effect<XwingArchiveResult, XwingOperationError>;
    readonly restore: (
      input: XwingEnvironmentInput,
    ) => Effect.Effect<XwingRestoreResult, XwingOperationError>;
    readonly delete: (
      input: XwingDeleteInput,
    ) => Effect.Effect<XwingDeleteResult, XwingOperationError>;
    readonly startApp: (
      input: XwingStartAppInput,
    ) => Effect.Effect<ReadonlyArray<XwingApplicationRun>, XwingOperationError>;
    readonly stopApp: (
      input: XwingStopAppInput,
    ) => Effect.Effect<XwingApplicationRun, XwingOperationError>;
    readonly readAppLogs: (
      input: XwingReadAppLogsInput,
    ) => Effect.Effect<XwingAppLogs, XwingOperationError>;
    readonly listAppCommands: (
      input: XwingListAppCommandsInput,
    ) => Effect.Effect<ReadonlyArray<XwingAppCommand>, XwingOperationError>;
  }
>()("t3/xwing/XwingOperations") {}

// How older Xwing rejects commands and flags this service relies on.
const UNSUPPORTED = /unknown (env|app) command|unknown flag "--sessions"/;

const FAILURE_CATEGORIES: ReadonlyArray<readonly [RegExp, XwingFailureCategory]> = [
  [/session "[^"\n]*" not found|matched 0 environments/, "environmentNotFound"],
  [/managed run "[^"\n]*" not found/, "runNotFound"],
  [/is not a valid branch name|refusing default branch/, "invalidBranch"],
  [/error: repo ".*" not found/, "sourceNotFound"],
  [/base "[^"\n]*" does not resolve/, "baseNotFound"],
  [
    /in use by external work|deletion blocked|prevent changing environment|before cleanup/,
    "blocked",
  ],
  [/already running with different settings|already active or uncertain/, "alreadyRunning"],
  [/has no command|is not declared in|requires a declared run command/, "commandNotDeclared"],
];

// Setup and cleanup can run installs or inspect large worktrees; they end with
// Xwing or with interruption, never with a server-chosen deadline.
const UNBOUNDED = Duration.infinity;
const DEFAULT_LOG_LIMIT = 100;

const sessionRef = (id: string) => `id:${id}`;

const isPresent = <A>(value: A | undefined): value is A => value !== undefined;

const toDependencies = (
  dependencies: ReadonlyArray<typeof DependencyWire.Type> | undefined,
): ReadonlyArray<XwingDependencyState> =>
  (dependencies ?? []).map((dependency) => ({
    path: dependency.path,
    manager: dependency.manager,
    status: dependency.status,
    reason: dependency.reason,
  }));

const toListedHold = (hold: typeof HoldWire.Type): XwingListedHold => ({
  environmentId: hold.session_id,
  owner: hold.owner,
  key: hold.key,
  label: hold.label,
  detail: hold.detail,
  createdAt: hold.created_at,
  updatedAt: hold.updated_at,
  environmentStatus: hold.status,
  environmentNumber: hold.number,
  environmentName: hold.name,
});

const toRun = (run: typeof RunWire.Type): XwingApplicationRun => ({
  id: run.id,
  name: run.name,
  repository: run.repo,
  status: run.status,
  pid: run.pid,
  exitCode: run.exit_code,
  startedAt: run.started_at,
  urls: run.urls ?? {},
});

const lines = (stdout: string) => stdout.split("\n").filter((line) => line.trim() !== "");

const stderrTail = (output: ProcessRunner.ProcessRunOutput) =>
  new Error(output.stderr.trim().slice(-2_000));

/** Builds the service around an Xwing executable name or path. */
export const make = Effect.fn("XwingOperations.make")(function* (command = "xwing") {
  const runner = yield* ProcessRunner.ProcessRunner;
  const environment = yield* HostProcess.Environment;
  // Undefined overrides remove inherited keys when ProcessRunner extends the host environment.
  const env = {
    ...Object.fromEntries(
      Object.keys(environment)
        .filter(isServerRuntimeEnvKey)
        .map((key) => [key, undefined]),
    ),
    ...WITHOUT_AGENT_IDENTITY,
  };

  const validate = <S extends Schema.Top & { readonly DecodingServices: never }>(
    operation: XwingOperationName,
    schema: S,
    input: unknown,
  ) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError((cause) => new XwingInvalidInputError({ operation, issue: cause.message })),
    );

  const run = (
    operation: XwingOperationName,
    args: ReadonlyArray<string>,
    options: {
      readonly unbounded?: boolean;
      readonly environmentId?: string;
      readonly maxOutputBytes?: number;
    } = {},
  ) =>
    runner
      .run({
        command,
        args,
        env,
        ...(options.unbounded ? { timeout: UNBOUNDED } : {}),
        ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
      })
      .pipe(
        Effect.mapError((cause) =>
          cause._tag === "ProcessSpawnError"
            ? new XwingUnavailableError({ command, cause })
            : new XwingOperationFailedError({
                operation,
                category: "incomplete",
                environmentId: options.environmentId,
                exitCode: null,
                cause,
              }),
        ),
      );

  const failure = (
    operation: XwingOperationName,
    output: ProcessRunner.ProcessRunOutput,
    extra: {
      readonly environmentId?: string | undefined;
      readonly blockers?: ReadonlyArray<string> | undefined;
      readonly runIds?: ReadonlyArray<string> | undefined;
    } = {},
  ) => {
    const cause = stderrTail(output);
    if (UNSUPPORTED.test(output.stderr)) {
      return new XwingOperationUnsupportedError({ operation, command, cause });
    }
    const category =
      FAILURE_CATEGORIES.find(([pattern]) => pattern.test(output.stderr))?.[1] ?? "failed";
    return new XwingOperationFailedError({
      operation,
      category,
      environmentId: category === "environmentNotFound" ? undefined : extra.environmentId,
      exitCode: output.code,
      blockers: extra.blockers,
      runIds: extra.runIds,
      ...(operation === "startApp" ? { diagnostics: output.stderr.trim().slice(-2_000) } : {}),
      cause,
    });
  };

  const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
    operation: XwingOperationName,
    schema: S,
    text: string,
    environmentId?: string,
  ) =>
    Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(
      Effect.mapError(
        (cause) =>
          new XwingOperationFailedError({
            operation,
            category: "unreadableOutput",
            environmentId,
            exitCode: 0,
            cause,
          }),
      ),
    );

  const decodeLines = <S extends Schema.Top & { readonly DecodingServices: never }>(
    operation: XwingOperationName,
    schema: S,
    stdout: string,
    environmentId?: string,
  ) => Effect.forEach(lines(stdout), (line) => decode(operation, schema, line, environmentId));

  const decodeSucceeded = <S extends Schema.Top & { readonly DecodingServices: never }>(
    operation: XwingOperationName,
    schema: S,
    output: ProcessRunner.ProcessRunOutput,
    environmentId?: string,
  ) =>
    output.code === 0
      ? decode(operation, schema, output.stdout, environmentId)
      : Effect.fail(failure(operation, output, { environmentId }));

  // The catalog needs epoch 17, the release that made archive and delete honor holds.
  const catalogEntry = Effect.fn("XwingOperations.catalogEntry")(function* (
    operation: XwingOperationName,
    id: XwingEnvironmentId,
  ) {
    const output = yield* run(operation, ["env", "list", "--sessions", "-o", "json"]);
    if (output.code !== 0) return yield* failure(operation, output);
    const entries = yield* decodeLines(operation, CatalogWire, output.stdout);
    return Option.fromNullishOr(entries.find((entry) => entry.id === id));
  });

  const create = Effect.fn("XwingOperations.create")(function* (input: XwingCreateInput) {
    const { name } = yield* validate("create", XwingCreateInput, input);
    const output = yield* run("create", ["env", "create", "--name", name, "-o", "json"], {
      unbounded: true,
    });
    const { session } = yield* decodeSucceeded("create", CreateWire, output);
    return {
      id: session.id,
      number: session.number,
      name: session.name ?? name,
      rootPath: session.path,
      createdAt: session.created_at,
    } satisfies XwingCreatedEnvironment;
  });

  const attachRepository = Effect.fn("XwingOperations.attachRepository")(function* (
    input: XwingAttachRepositoryInput,
  ) {
    const { id, sourcePath, branch, base } = yield* validate(
      "attachRepository",
      XwingAttachRepositoryInput,
      input,
    );
    yield* Effect.annotateCurrentSpan("xwing.environment", id);
    const output = yield* run(
      "attachRepository",
      [
        "env",
        "add",
        "--session",
        sessionRef(id),
        "--repo",
        sourcePath,
        "--branch",
        branch,
        ...(base === undefined ? [] : ["--base", base]),
        "-o",
        "json",
      ],
      { unbounded: true, environmentId: id },
    );
    const added = yield* decodeSucceeded("attachRepository", AddWire, output, id);
    return {
      environmentId: id,
      name: added.repo,
      path: added.path,
      branch: added.branch,
      created: added.created,
      stale: added.stale,
      refreshResult: added.refresh_result,
      refreshReason: added.refresh_reason,
      baseRevision: added.base_revision,
      dependencies: toDependencies(added.dependencies),
      dependencyWarnings: added.dependency_warnings ?? [],
    } satisfies XwingAttachedRepository;
  });

  const repair = Effect.fn("XwingOperations.repair")(function* (input: XwingEnvironmentInput) {
    const { id } = yield* validate("repair", XwingEnvironmentInput, input);
    yield* Effect.annotateCurrentSpan("xwing.environment", id);
    const output = yield* run(
      "repair",
      ["env", "repair", "--session", sessionRef(id), "-o", "json"],
      {
        unbounded: true,
        environmentId: id,
      },
    );
    // Repair prints the session it reached before exiting nonzero for what remains.
    const printed =
      output.code === 0
        ? Option.some(yield* decode("repair", SessionWire, output.stdout, id))
        : yield* Effect.option(decode("repair", SessionWire, output.stdout, id));
    if (Option.isNone(printed)) return yield* failure("repair", output, { environmentId: id });
    const session = printed.value;
    return {
      environmentId: session.id,
      complete: output.code === 0,
      exitCode: output.code ?? 0,
      status: session.status,
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
        dependencies: toDependencies(repository.dependencies),
      })),
      pendingRepositories: (session.pending_repositories ?? []).map((pending) => ({
        name: pending.name,
        sourcePath: pending.source,
        branch: pending.branch,
        base: pending.base,
        error: pending.error.slice(0, 500),
        lastAttemptedAt: pending.last_attempted_at,
      })),
    } satisfies XwingRepairResult;
  });

  const registerHold = Effect.fn("XwingOperations.registerHold")(function* (
    input: XwingRegisterHoldInput,
  ) {
    const { id, owner, key, label, detail } = yield* validate(
      "registerHold",
      XwingRegisterHoldInput,
      input,
    );
    const output = yield* run("registerHold", [
      "env",
      "hold",
      "register",
      "--session",
      sessionRef(id),
      "--owner",
      owner,
      "--key",
      key,
      "--label",
      label,
      ...(detail === undefined || detail === "" ? [] : ["--detail", detail]),
      "-o",
      "json",
    ]);
    const hold = yield* decodeSucceeded("registerHold", RegisteredHoldWire, output, id);
    return {
      hold: toListedHold(hold),
      result: hold.result,
    } satisfies XwingRegisterHoldResult;
  });

  const releaseHold = Effect.fn("XwingOperations.releaseHold")(function* (
    input: XwingReleaseHoldInput,
  ) {
    const { id, owner, key } = yield* validate("releaseHold", XwingReleaseHoldInput, input);
    // `id:` lets Xwing release a hold left on an environment that no longer exists.
    const output = yield* run("releaseHold", [
      "env",
      "hold",
      "release",
      "--session",
      sessionRef(id),
      "--owner",
      owner,
      "--key",
      key,
      "-o",
      "json",
    ]);
    const released = yield* decodeSucceeded("releaseHold", ReleasedHoldWire, output, id);
    return {
      environmentId: released.session_id,
      owner: released.owner,
      key: released.key,
      environmentStatus: released.status,
      result: released.result,
    } satisfies XwingReleaseHoldResult;
  });

  const listHolds = Effect.fn("XwingOperations.listHolds")(function* (input: XwingListHoldsInput) {
    const { id, owner } = yield* validate("listHolds", XwingListHoldsInput, input);
    const output = yield* run("listHolds", [
      "env",
      "hold",
      "list",
      ...(id === undefined ? [] : ["--session", sessionRef(id)]),
      ...(owner === undefined ? [] : ["--owner", owner]),
      "-o",
      "json",
    ]);
    if (output.code !== 0) return yield* failure("listHolds", output, { environmentId: id });
    const holds = yield* decodeLines("listHolds", HoldWire, output.stdout, id);
    return holds.map(toListedHold);
  });

  const previewCleanup = Effect.fn("XwingOperations.previewCleanup")(function* (
    input: XwingEnvironmentInput,
  ) {
    const { id } = yield* validate("previewCleanup", XwingEnvironmentInput, input);
    yield* Effect.annotateCurrentSpan("xwing.environment", id);
    const output = yield* run(
      "previewCleanup",
      ["env", "delete", "--session", sessionRef(id), "--dry-run", "-o", "json"],
      { unbounded: true, environmentId: id },
    );
    const report = yield* decodeSucceeded("previewCleanup", DeleteReportWire, output, id);
    if (report.holds === undefined) {
      return yield* new XwingOperationUnsupportedError({
        operation: "previewCleanup",
        command,
        cause: new Error("deletion preview has no holds"),
      });
    }
    return {
      environmentId: report.id,
      number: report.number > 0 ? report.number : undefined,
      name: report.name === "" ? report.id : report.name,
      status: report.status,
      rootPath: report.root,
      worktrees: report.worktrees,
      holds: report.holds.map((hold) => ({
        environmentId: hold.session_id,
        owner: hold.owner,
        key: hold.key,
        label: hold.label,
        detail: hold.detail,
        createdAt: hold.created_at,
        updatedAt: hold.updated_at,
      })),
      blockers: report.blockers,
      retainedPaths: report.retained_paths,
      deletable: report.blockers.length === 0,
    } satisfies XwingCleanupPreview;
  });

  const listAppCommands = Effect.fn("XwingOperations.listAppCommands")(function* (
    input: XwingListAppCommandsInput,
  ) {
    const { id, repository } = yield* validate("listAppCommands", XwingListAppCommandsInput, input);
    const output = yield* run(
      "listAppCommands",
      [
        "app",
        "commands",
        "--session",
        sessionRef(id),
        "--repo",
        repository,
        "--limit",
        "0",
        "-o",
        "json",
      ],
      { environmentId: id },
    );
    if (output.code !== 0) return yield* failure("listAppCommands", output, { environmentId: id });
    const records = yield* decodeLines(
      "listAppCommands",
      Schema.Union([CommandWire, CommandSummaryWire]),
      output.stdout,
      id,
    );
    return records.flatMap((record) =>
      record.kind === "command"
        ? [{ name: record.name, description: record.description } satisfies XwingAppCommand]
        : [],
    );
  });

  const archive = Effect.fn("XwingOperations.archive")(function* (input: XwingEnvironmentInput) {
    const { id } = yield* validate("archive", XwingEnvironmentInput, input);
    yield* Effect.annotateCurrentSpan("xwing.environment", id);
    const entry = yield* catalogEntry("archive", id);
    if (Option.isNone(entry)) {
      return yield* new XwingOperationFailedError({
        operation: "archive",
        category: "environmentNotFound",
        exitCode: null,
        cause: new Error("environment is not in the catalog"),
      });
    }
    if (entry.value.status === "archived") {
      return {
        environmentId: id,
        outcome: "alreadyArchived",
        archivePath: entry.value.path,
      } satisfies XwingArchiveResult;
    }
    const output = yield* run(
      "archive",
      ["env", "archive", "--session", sessionRef(id), "-o", "json"],
      {
        unbounded: true,
        environmentId: id,
      },
    );
    const archived = yield* decodeSucceeded("archive", ArchiveWire, output, id);
    return {
      environmentId: id,
      outcome: "archived",
      archivePath: archived.path,
    } satisfies XwingArchiveResult;
  });

  const restore = Effect.fn("XwingOperations.restore")(function* (input: XwingEnvironmentInput) {
    const { id } = yield* validate("restore", XwingEnvironmentInput, input);
    const entry = yield* catalogEntry("restore", id);
    if (Option.isNone(entry))
      return yield* new XwingOperationFailedError({
        operation: "restore",
        category: "environmentNotFound",
        environmentId: id,
        exitCode: null,
        cause: new Error("environment is not in the catalog"),
      });
    if (entry.value.status === "active")
      return {
        environmentId: id,
        outcome: "alreadyActive",
        rootPath: entry.value.path,
      } satisfies XwingRestoreResult;
    // Restore prints a path rather than JSON; verify the catalog after it succeeds.
    const output = yield* run("restore", ["env", "restore", "--session", id], {
      unbounded: true,
      environmentId: id,
    });
    if (output.code !== 0) return yield* failure("restore", output, { environmentId: id });
    const restored = yield* catalogEntry("restore", id);
    if (Option.isNone(restored) || restored.value.status !== "active")
      return yield* new XwingOperationFailedError({
        operation: "restore",
        category: "unreadableOutput",
        environmentId: id,
        exitCode: 0,
        cause: new Error("restored environment is not active"),
      });
    return {
      environmentId: id,
      outcome: "restored",
      rootPath: restored.value.path,
    } satisfies XwingRestoreResult;
  });

  const deleteEnvironment = Effect.fn("XwingOperations.delete")(function* (
    input: XwingDeleteInput,
  ) {
    const { id } = yield* validate("delete", XwingDeleteInput, input);
    yield* Effect.annotateCurrentSpan("xwing.environment", id);
    const absent = {
      environmentId: id,
      outcome: "absent",
      removedWorktrees: [],
      retainedPaths: [],
      stoppedApplications: [],
    } satisfies XwingDeleteResult;
    if (Option.isNone(yield* catalogEntry("delete", id))) return absent;
    const output = yield* run(
      "delete",
      ["env", "delete", "--session", sessionRef(id), "--confirm", id, "-o", "json"],
      { unbounded: true, environmentId: id },
    );
    if (output.code !== 0) {
      const refused = yield* Effect.option(decode("delete", DeleteReportWire, output.stdout, id));
      const error = failure("delete", output, {
        environmentId: id,
        blockers: Option.isSome(refused) ? refused.value.blockers : undefined,
      });
      return error._tag === "XwingOperationFailedError" && error.category === "environmentNotFound"
        ? absent
        : yield* error;
    }
    const report = yield* decode("delete", DeleteReportWire, output.stdout, id);
    if (!report.deleted) {
      return yield* new XwingOperationFailedError({
        operation: "delete",
        category: "unreadableOutput",
        environmentId: id,
        exitCode: 0,
        blockers: report.blockers,
        cause: new Error("Xwing exited 0 without deleting"),
      });
    }
    return {
      environmentId: id,
      outcome: "deleted",
      removedWorktrees: report.removed_worktrees,
      retainedPaths: report.retained_paths,
      stoppedApplications: report.apps ?? [],
    } satisfies XwingDeleteResult;
  });

  const startApp = Effect.fn("XwingOperations.startApp")(function* (input: XwingStartAppInput) {
    const {
      id,
      repository,
      command: declared,
      profile,
    } = yield* validate("startApp", XwingStartAppInput, input);
    yield* Effect.annotateCurrentSpan("xwing.environment", id);
    // --detach keeps a command without app settings from running in the
    // foreground; Xwing already detaches declared apps.
    const output = yield* run(
      "startApp",
      [
        "app",
        "run",
        "--session",
        sessionRef(id),
        "--repo",
        repository,
        "--detach",
        ...(declared === undefined || declared === "run" ? [] : ["--command", declared]),
        ...(profile === undefined ? [] : ["--profile", profile]),
        "-o",
        "json",
      ],
      { environmentId: id },
    );
    if (output.code !== 0) {
      const recorded = yield* Effect.forEach(lines(output.stdout), (line) =>
        Effect.option(decode("startApp", RunWire, line, id)),
      );
      return yield* failure("startApp", output, {
        environmentId: id,
        runIds: recorded
          .map(Option.getOrUndefined)
          .filter(isPresent)
          .map((run) => run.id),
      });
    }
    const runs = yield* decodeLines("startApp", RunWire, output.stdout, id);
    if (runs.length === 0) {
      return yield* new XwingOperationFailedError({
        operation: "startApp",
        category: "unreadableOutput",
        environmentId: id,
        exitCode: 0,
        cause: new Error("Xwing reported no started run"),
      });
    }
    return runs.map(toRun);
  });

  const stopApp = Effect.fn("XwingOperations.stopApp")(function* (input: XwingStopAppInput) {
    const { id, runId } = yield* validate("stopApp", XwingStopAppInput, input);
    const output = yield* run(
      "stopApp",
      ["app", "stop", "--session", sessionRef(id), "--run", runId, "-o", "json"],
      { environmentId: id },
    );
    return toRun(yield* decodeSucceeded("stopApp", RunWire, output, id));
  });

  const readAppLogs = Effect.fn("XwingOperations.readAppLogs")(function* (
    input: XwingReadAppLogsInput,
  ) {
    const { id, runId, limit, stream } = yield* validate(
      "readAppLogs",
      XwingReadAppLogsInput,
      input,
    );
    const output = yield* run(
      "readAppLogs",
      [
        "app",
        "logs",
        "--session",
        sessionRef(id),
        "--run",
        runId,
        "--limit",
        String(limit ?? DEFAULT_LOG_LIMIT),
        ...(stream === undefined ? [] : ["--stream", stream]),
        "-o",
        "json",
      ],
      {
        environmentId: id,
        // Xwing's 32 KiB records can expand sixfold when JSON escapes control characters.
        maxOutputBytes: (limit ?? DEFAULT_LOG_LIMIT) * (32 * 1024 * 6 + 1024) + 1024,
      },
    );
    if (output.code !== 0) return yield* failure("readAppLogs", output, { environmentId: id });
    const records: Array<XwingAppLogs["records"][number]> = [];
    let summary: { readonly matched: number; readonly truncated: boolean } | undefined;
    for (const line of yield* decodeLines("readAppLogs", LogLineWire, output.stdout, id)) {
      if (line.kind === "log_summary") {
        summary = line;
        continue;
      }
      const binary = line.encoding === "base64";
      records.push({
        sequence: line.seq,
        time: line.time,
        stream: line.stream,
        text: binary ? Buffer.from(line.data ?? "", "base64").toString("utf8") : (line.text ?? ""),
        binary,
      });
    }
    return {
      runId,
      records,
      matched: summary?.matched ?? records.length,
      truncated: summary?.truncated ?? false,
    } satisfies XwingAppLogs;
  });

  return XwingOperations.of({
    create,
    attachRepository,
    repair,
    registerHold,
    releaseHold,
    listHolds,
    previewCleanup,
    archive,
    restore,
    delete: deleteEnvironment,
    startApp,
    stopApp,
    readAppLogs,
    listAppCommands,
  });
});

export const layer = Layer.effect(XwingOperations, make());
