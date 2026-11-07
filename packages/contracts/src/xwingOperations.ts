import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import {
  XwingDiagnosticCause,
  XwingEnvironmentId,
  XwingRepositoryDetail,
  XwingUnavailableError,
} from "./xwingEnvironments.ts";

const hasNoControlCharacters = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

const SingleLine = (maxLength: number) =>
  Schema.String.check(
    Schema.isMaxLength(maxLength),
    Schema.makeFilter(
      (value: string) =>
        (value.trim().length > 0 && hasNoControlCharacters(value)) ||
        "must be a non-blank line without control characters",
    ),
  );

// Git accepts more than this; the narrower set keeps names unambiguous as argv.
const isSafeBranchName = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._/+-]*$/.test(value) &&
  !value.includes("..") &&
  !value.includes("//") &&
  !value.includes("/.") &&
  !value.endsWith("/") &&
  !value.endsWith(".") &&
  !value.split("/").some((part) => part.endsWith(".lock"));

/** A branch Xwing creates or checks out. Xwing's own default can be an invalid name. */
export const XwingBranchName = Schema.String.check(
  Schema.isMaxLength(200),
  Schema.makeFilter(
    (value: string) => isSafeBranchName(value) || "must be a valid Git branch name",
  ),
);

/** A local branch, remote branch or commit a new branch forks from. */
export const XwingBaseRef = Schema.String.check(
  Schema.isMaxLength(200),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._/+@~^-]*$/),
  Schema.makeFilter((value: string) => !value.includes("..") || "must name a single ref or commit"),
);

const AbsolutePath = Schema.String.check(
  Schema.isMaxLength(4_096),
  Schema.isPattern(/^(\/|[A-Za-z]:[\\/])/),
  Schema.makeFilter(
    (value: string) => hasNoControlCharacters(value) || "must not contain control characters",
  ),
);

/** Xwing's owner and key syntax for holds. */
export const XwingHoldToken = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:@/+=-]{0,127}$/),
);

export const XwingRunId = Schema.String.check(Schema.isPattern(/^run-[0-9a-f]{8,64}$/));

export const XwingCreateInput = Schema.Struct({ name: SingleLine(200) });
export type XwingCreateInput = typeof XwingCreateInput.Type;

export const XwingAttachRepositoryInput = Schema.Struct({
  id: XwingEnvironmentId,
  sourcePath: AbsolutePath,
  branch: XwingBranchName,
  base: Schema.optional(XwingBaseRef),
});
export type XwingAttachRepositoryInput = typeof XwingAttachRepositoryInput.Type;

export const XwingEnvironmentInput = Schema.Struct({ id: XwingEnvironmentId });
export type XwingEnvironmentInput = typeof XwingEnvironmentInput.Type;

export const XwingRegisterHoldInput = Schema.Struct({
  id: XwingEnvironmentId,
  owner: XwingHoldToken,
  key: XwingHoldToken,
  label: SingleLine(200),
  detail: Schema.optional(
    Schema.String.check(
      Schema.isMaxLength(2_000),
      Schema.makeFilter(
        (value: string) =>
          hasNoControlCharacters(value) || "must be one line without control characters",
      ),
    ),
  ),
});
export type XwingRegisterHoldInput = typeof XwingRegisterHoldInput.Type;

export const XwingReleaseHoldInput = Schema.Struct({
  id: XwingEnvironmentId,
  owner: XwingHoldToken,
  key: XwingHoldToken,
});
export type XwingReleaseHoldInput = typeof XwingReleaseHoldInput.Type;

export const XwingListHoldsInput = Schema.Struct({
  id: Schema.optional(XwingEnvironmentId),
  owner: Schema.optional(XwingHoldToken),
});
export type XwingListHoldsInput = typeof XwingListHoldsInput.Type;

export const XwingDeleteInput = Schema.Struct({
  id: XwingEnvironmentId,
  /** Must repeat `id` exactly. */
  confirmId: Schema.String,
}).check(
  Schema.makeFilter(
    (input) => input.confirmId === input.id || "confirmId must equal the environment id",
  ),
);
export type XwingDeleteInput = typeof XwingDeleteInput.Type;

export const XwingStartAppInput = Schema.Struct({
  id: XwingEnvironmentId,
  repository: SingleLine(200),
  /** A declared command; omitted means the declared `run` command. */
  command: Schema.optional(
    Schema.String.check(Schema.isMaxLength(64), Schema.isPattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
  ),
  profile: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)),
  ),
});
export type XwingStartAppInput = typeof XwingStartAppInput.Type;

export const XwingStopAppInput = Schema.Struct({
  id: XwingEnvironmentId,
  runId: XwingRunId,
});
export type XwingStopAppInput = typeof XwingStopAppInput.Type;

export const XwingListAppCommandsInput = Schema.Struct({
  id: XwingEnvironmentId,
  repository: SingleLine(200),
});
export type XwingListAppCommandsInput = typeof XwingListAppCommandsInput.Type;

/** A command the repository declares in `.xwing-env.yaml`. */
export const XwingAppCommand = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
});
export type XwingAppCommand = typeof XwingAppCommand.Type;

export const XwingReadAppLogsInput = Schema.Struct({
  id: XwingEnvironmentId,
  runId: XwingRunId,
  /** Most recent records to return; defaults to 100. Records hold up to 32 KiB each. */
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
  stream: Schema.optional(Schema.Literals(["stdout", "stderr"])),
});
export type XwingReadAppLogsInput = typeof XwingReadAppLogsInput.Type;

export const XwingCreatedEnvironment = Schema.Struct({
  id: XwingEnvironmentId,
  number: Schema.optional(Schema.Number),
  name: Schema.String,
  rootPath: Schema.String,
  createdAt: Schema.String,
});
export type XwingCreatedEnvironment = typeof XwingCreatedEnvironment.Type;

export const XwingDependencyState = Schema.Struct({
  path: Schema.String,
  manager: Schema.optional(Schema.String),
  /** Xwing's install state, such as `missing`; only Xwing decides whether it is current. */
  status: Schema.String,
  reason: Schema.optional(Schema.String),
});
export type XwingDependencyState = typeof XwingDependencyState.Type;

export const XwingAttachedRepository = Schema.Struct({
  environmentId: XwingEnvironmentId,
  name: Schema.String,
  path: Schema.String,
  branch: Schema.String,
  /** False when the environment already held the repository and Xwing refreshed it. */
  created: Schema.Boolean,
  /** The fetch failed and the checkout forked from the last known base. */
  stale: Schema.Boolean,
  refreshResult: Schema.optional(Schema.String),
  refreshReason: Schema.optional(Schema.String),
  baseRevision: Schema.optional(Schema.String),
  dependencies: Schema.Array(XwingDependencyState),
  dependencyWarnings: Schema.Array(Schema.String),
});
export type XwingAttachedRepository = typeof XwingAttachedRepository.Type;

export const XwingRepositorySetup = XwingRepositoryDetail.mapFields(
  Struct.assign({ dependencies: Schema.Array(XwingDependencyState) }),
);
export type XwingRepositorySetup = typeof XwingRepositorySetup.Type;

export const XwingPendingRepository = Schema.Struct({
  name: Schema.String,
  sourcePath: Schema.String,
  branch: Schema.String,
  base: Schema.optional(Schema.String),
  /** Xwing's recorded failure, shortened. */
  error: Schema.String,
  lastAttemptedAt: Schema.String,
});
export type XwingPendingRepository = typeof XwingPendingRepository.Type;

export const XwingRepairResult = Schema.Struct({
  environmentId: XwingEnvironmentId,
  /** Xwing exited 0. When false, the state below is what Xwing printed before failing. */
  complete: Schema.Boolean,
  exitCode: Schema.Number,
  status: Schema.optional(Schema.String),
  repositories: Schema.Array(XwingRepositorySetup),
  pendingRepositories: Schema.Array(XwingPendingRepository),
});
export type XwingRepairResult = typeof XwingRepairResult.Type;

export const XwingHoldEnvironmentStatus = Schema.Literals(["active", "archived", "missing"]);
export type XwingHoldEnvironmentStatus = typeof XwingHoldEnvironmentStatus.Type;

export const XwingHold = Schema.Struct({
  environmentId: XwingEnvironmentId,
  owner: Schema.String,
  key: Schema.String,
  label: Schema.String,
  detail: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type XwingHold = typeof XwingHold.Type;

export const XwingListedHold = XwingHold.mapFields(
  Struct.assign({
    environmentStatus: XwingHoldEnvironmentStatus,
    environmentNumber: Schema.optional(Schema.Number),
    environmentName: Schema.optional(Schema.String),
  }),
);
export type XwingListedHold = typeof XwingListedHold.Type;

export const XwingRegisterHoldResult = Schema.Struct({
  hold: XwingListedHold,
  result: Schema.Literals(["created", "updated", "unchanged"]),
});
export type XwingRegisterHoldResult = typeof XwingRegisterHoldResult.Type;

export const XwingReleaseHoldResult = Schema.Struct({
  environmentId: XwingEnvironmentId,
  owner: Schema.String,
  key: Schema.String,
  environmentStatus: XwingHoldEnvironmentStatus,
  result: Schema.Literals(["released", "absent"]),
});
export type XwingReleaseHoldResult = typeof XwingReleaseHoldResult.Type;

export const XwingCleanupWorktree = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  dirty: Schema.Boolean,
  untracked: Schema.Boolean,
  /** Ignored files exist; recognized dependency and cache paths do not block deletion. */
  ignored: Schema.Boolean,
});
export type XwingCleanupWorktree = typeof XwingCleanupWorktree.Type;

/**
 * Xwing's deletion preview at one moment. `deletable` is Xwing's verdict only:
 * a caller must still check its own threads, schedules and processes and take a
 * fresh preview immediately before deleting.
 */
export const XwingCleanupPreview = Schema.Struct({
  environmentId: XwingEnvironmentId,
  number: Schema.optional(Schema.Number),
  name: Schema.String,
  /** Xwing's environment status, such as `ready` or `archived`. */
  status: Schema.String,
  rootPath: Schema.String,
  worktrees: Schema.Array(XwingCleanupWorktree),
  holds: Schema.Array(XwingHold),
  /** Xwing's reasons, including inspection failures; empty only when nothing blocks. */
  blockers: Schema.Array(Schema.String),
  /** Kept after deletion: run logs, candidate data and source checkouts. */
  retainedPaths: Schema.Array(Schema.String),
  deletable: Schema.Boolean,
});
export type XwingCleanupPreview = typeof XwingCleanupPreview.Type;

export const XwingArchiveResult = Schema.Struct({
  environmentId: XwingEnvironmentId,
  outcome: Schema.Literals(["archived", "alreadyArchived"]),
  archivePath: Schema.String,
});
export type XwingArchiveResult = typeof XwingArchiveResult.Type;

export const XwingDeleteResult = Schema.Struct({
  environmentId: XwingEnvironmentId,
  /** `absent` means Xwing has no environment with this id, deleted earlier or never present. */
  outcome: Schema.Literals(["deleted", "absent"]),
  removedWorktrees: Schema.Array(Schema.String),
  retainedPaths: Schema.Array(Schema.String),
  stoppedApplications: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      status: Schema.String,
    }),
  ),
});
export type XwingDeleteResult = typeof XwingDeleteResult.Type;

export const XwingAppLogRecord = Schema.Struct({
  sequence: Schema.Number,
  time: Schema.String,
  stream: Schema.Literals(["stdout", "stderr"]),
  text: Schema.String,
  /** Invalid UTF-8 output; `text` is a lossy decoding. */
  binary: Schema.Boolean,
});
export type XwingAppLogRecord = typeof XwingAppLogRecord.Type;

export const XwingAppLogs = Schema.Struct({
  runId: XwingRunId,
  /** Oldest first: the newest `limit` retained records. */
  records: Schema.Array(XwingAppLogRecord),
  /** Retained matching records; rotated-away output is not counted. */
  matched: Schema.Number,
  truncated: Schema.Boolean,
});
export type XwingAppLogs = typeof XwingAppLogs.Type;

export const XwingOperationName = Schema.Literals([
  "create",
  "attachRepository",
  "repair",
  "registerHold",
  "releaseHold",
  "listHolds",
  "previewCleanup",
  "archive",
  "delete",
  "startApp",
  "stopApp",
  "readAppLogs",
  "listAppCommands",
]);
export type XwingOperationName = typeof XwingOperationName.Type;

export const XwingFailureCategory = Schema.Literals([
  "environmentNotFound",
  "runNotFound",
  "invalidBranch",
  "sourceNotFound",
  "baseNotFound",
  "blocked",
  "alreadyRunning",
  "commandNotDeclared",
  /** Xwing exited 0 but printed something this server cannot read. */
  "unreadableOutput",
  /** Xwing did not finish: interrupted, timed out or its output could not be read. */
  "incomplete",
  "failed",
]);
export type XwingFailureCategory = typeof XwingFailureCategory.Type;

const failureMessages: Record<XwingFailureCategory, string> = {
  environmentNotFound: "Xwing has no such environment.",
  runNotFound: "Xwing has no such application run in this environment.",
  invalidBranch: "Xwing rejected the branch. Choose a task branch; the default branch is reserved.",
  sourceNotFound: "Xwing could not find the source repository.",
  baseNotFound: "The base ref does not resolve in the source repository.",
  blocked:
    "Xwing refused because the environment is held, running owned processes or has work to keep.",
  alreadyRunning:
    "An application with that name is already running with different settings; stop it first.",
  commandNotDeclared: "The repository does not declare that command in .xwing-env.yaml.",
  unreadableOutput:
    "Xwing printed output this server cannot read; Xwing may be newer or older than expected.",
  incomplete: "Xwing did not finish.",
  failed: "Xwing failed.",
};

export class XwingOperationFailedError extends Schema.TaggedError<XwingOperationFailedError>()(
  "XwingOperationFailedError",
  {
    operation: XwingOperationName,
    category: XwingFailureCategory,
    /** Set when the environment exists, so a failed setup step can be retried against it. */
    environmentId: Schema.optional(Schema.String),
    exitCode: Schema.NullOr(Schema.Number),
    /** Xwing's own blocker lines for a refused deletion. */
    blockers: Schema.optional(Schema.Array(Schema.String)),
    /** Runs Xwing recorded before a start failed. */
    runIds: Schema.optional(Schema.Array(Schema.String)),
    cause: XwingDiagnosticCause,
  },
) {
  override get message(): string {
    return `Xwing ${this.operation}: ${failureMessages[this.category]}`;
  }
}

export class XwingOperationUnsupportedError extends Schema.TaggedError<XwingOperationUnsupportedError>()(
  "XwingOperationUnsupportedError",
  {
    operation: XwingOperationName,
    command: Schema.String,
    cause: XwingDiagnosticCause,
  },
) {
  override get message(): string {
    return `Xwing '${this.command}' is too old for ${this.operation}: T3 Code needs environment holds (Xwing capability epoch 17). Update Xwing on this machine.`;
  }
}

export class XwingInvalidInputError extends Schema.TaggedError<XwingInvalidInputError>()(
  "XwingInvalidInputError",
  { operation: XwingOperationName, issue: Schema.String },
) {
  override get message(): string {
    return `Invalid input for Xwing ${this.operation}: ${this.issue}`;
  }
}

export const XwingOperationError = Schema.Union([
  XwingUnavailableError,
  XwingOperationUnsupportedError,
  XwingInvalidInputError,
  XwingOperationFailedError,
]);
export type XwingOperationError = typeof XwingOperationError.Type;
