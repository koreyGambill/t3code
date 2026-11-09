import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { XwingApplicationRun, XwingEnvironmentId } from "./xwingEnvironments.ts";
import {
  XwingAppLogs,
  XwingAttachedRepository,
  XwingBaseRef,
  XwingBranchName,
  XwingCleanupWorktree,
  XwingFailureCategory,
  XwingRepairResult,
  XwingRunId,
} from "./xwingOperations.ts";

const EnvironmentName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(200),
  Schema.makeFilter((value: string) => !/[\u0000-\u001f\u007f]/.test(value) || "must be one line"),
);
const RepositoryName = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const DeclaredCommand = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/),
);

/**
 * Creates an Xwing environment and checks the project's repository out on `branch`. The branch is
 * required: Xwing derives one from the name otherwise, and a spaced name is not a valid branch.
 */
export const DevelopmentEnvironmentCreateInput = Schema.Struct({
  projectId: ProjectId,
  name: EnvironmentName,
  branch: XwingBranchName,
  base: Schema.optional(XwingBaseRef),
});
export type DevelopmentEnvironmentCreateInput = typeof DevelopmentEnvironmentCreateInput.Type;

/** Retries checking the project's repository out in an environment that already exists. */
export const DevelopmentEnvironmentAttachInput = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
  projectId: ProjectId,
  branch: XwingBranchName,
  base: Schema.optional(XwingBaseRef),
});
export type DevelopmentEnvironmentAttachInput = typeof DevelopmentEnvironmentAttachInput.Type;

export const DevelopmentEnvironmentRef = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
});
export type DevelopmentEnvironmentRef = typeof DevelopmentEnvironmentRef.Type;

export const DevelopmentEnvironmentLifecycleReason = Schema.Literals([
  ...XwingFailureCategory.literals,
  "xwing-unavailable",
  "xwing-unsupported",
  "invalid-input",
  "project-missing",
  "not-a-repository",
  "assessment-changed",
  "cleanup-blocked",
  "state-unreadable",
]);
export type DevelopmentEnvironmentLifecycleReason =
  typeof DevelopmentEnvironmentLifecycleReason.Type;

/** A setup step Xwing refused or did not finish. The environment, when named, still exists. */
export const DevelopmentEnvironmentSetupFailure = Schema.Struct({
  reason: DevelopmentEnvironmentLifecycleReason,
  message: Schema.String,
});
export type DevelopmentEnvironmentSetupFailure = typeof DevelopmentEnvironmentSetupFailure.Type;

/**
 * `repository` is null when checking out failed; the environment exists and `failure` says why,
 * so the client retries the checkout against `xwingEnvironmentId` instead of creating another.
 */
export const DevelopmentEnvironmentSetupResult = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
  repository: Schema.NullOr(XwingAttachedRepository),
  failure: Schema.NullOr(DevelopmentEnvironmentSetupFailure),
});
export type DevelopmentEnvironmentSetupResult = typeof DevelopmentEnvironmentSetupResult.Type;

export const DevelopmentEnvironmentRepairResult = XwingRepairResult;

export const DevelopmentEnvironmentAppCommandsInput = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
  repository: RepositoryName,
});
export type DevelopmentEnvironmentAppCommandsInput =
  typeof DevelopmentEnvironmentAppCommandsInput.Type;

export const DevelopmentEnvironmentAppCommand = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
});
export type DevelopmentEnvironmentAppCommand = typeof DevelopmentEnvironmentAppCommand.Type;

export const DevelopmentEnvironmentAppCommands = Schema.Array(DevelopmentEnvironmentAppCommand);

export const DevelopmentEnvironmentStartAppInput = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
  repository: RepositoryName,
  /** A declared command; omitted means the declared `run` command. */
  command: Schema.optional(DeclaredCommand),
});
export type DevelopmentEnvironmentStartAppInput = typeof DevelopmentEnvironmentStartAppInput.Type;

export const DevelopmentEnvironmentAppRuns = Schema.Array(XwingApplicationRun);

export const DevelopmentEnvironmentStopAppInput = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
  runId: XwingRunId,
});
export type DevelopmentEnvironmentStopAppInput = typeof DevelopmentEnvironmentStopAppInput.Type;

export const DevelopmentEnvironmentAppLogsInput = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
  runId: XwingRunId,
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
});
export type DevelopmentEnvironmentAppLogsInput = typeof DevelopmentEnvironmentAppLogsInput.Type;

export const DevelopmentEnvironmentAppLogs = XwingAppLogs;

/** Why a thread keeps the environment, or null when it does not. */
export const DevelopmentEnvironmentThreadBlock = Schema.Literals([
  "working",
  "background-work",
  "terminal-command",
  "unsettled",
]);
export type DevelopmentEnvironmentThreadBlock = typeof DevelopmentEnvironmentThreadBlock.Type;

/** A thread that used the environment. Its history stays in T3 Code after cleanup. */
export const DevelopmentEnvironmentCleanupThread = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  /** The thread still works in this environment's checkout. */
  current: Schema.Boolean,
  archivedAt: Schema.NullOr(IsoDateTime),
  settledAt: Schema.NullOr(IsoDateTime),
  /** Null for a thread that works in the checkout without a recorded selection. */
  lastSelectedAt: Schema.NullOr(IsoDateTime),
  block: Schema.NullOr(DevelopmentEnvironmentThreadBlock),
});
export type DevelopmentEnvironmentCleanupThread = typeof DevelopmentEnvironmentCleanupThread.Type;

export const DevelopmentEnvironmentCleanupSchedule = Schema.Struct({
  scheduledTaskId: ScheduledTaskId,
  title: Schema.String,
  threadId: Schema.NullOr(ThreadId),
});
export type DevelopmentEnvironmentCleanupSchedule =
  typeof DevelopmentEnvironmentCleanupSchedule.Type;

export const DevelopmentEnvironmentCleanupHold = Schema.Struct({
  owner: Schema.String,
  key: Schema.String,
  label: Schema.String,
  /** The thread a T3 Code hold names, when it is one this server still knows. */
  threadId: Schema.NullOr(ThreadId),
});
export type DevelopmentEnvironmentCleanupHold = typeof DevelopmentEnvironmentCleanupHold.Type;

/**
 * T3 Code's verdict on deleting one Xwing environment, combining Xwing's own preview with every
 * thread that used it, schedules that would run there and holds from other owners. `canClean` is
 * true only when nothing blocks. Cleanup must send back `fingerprint`; any change since refuses it.
 */
export const DevelopmentEnvironmentCleanupAssessment = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
  number: Schema.optional(Schema.Number),
  name: Schema.String,
  rootPath: Schema.String,
  assessedAt: IsoDateTime,
  fingerprint: Schema.String,
  canClean: Schema.Boolean,
  threads: Schema.Array(DevelopmentEnvironmentCleanupThread),
  /** Enabled schedules that would run in this environment. Each blocks. */
  schedules: Schema.Array(DevelopmentEnvironmentCleanupSchedule),
  /** This server's holds; released by cleanup, never by settling a thread. */
  ownHolds: Schema.Array(DevelopmentEnvironmentCleanupHold),
  /** Holds of other owners, including other T3 Code servers. Each blocks; T3 never releases them. */
  foreignHolds: Schema.Array(DevelopmentEnvironmentCleanupHold),
  /** Xwing's remaining reasons, such as uncommitted work. Each blocks. */
  xwingBlockers: Schema.Array(Schema.String),
  worktrees: Schema.Array(XwingCleanupWorktree),
  /** Apps Xwing will stop when it deletes the environment. */
  runningApps: Schema.Array(XwingApplicationRun),
  /** Kept after deletion: branches stay in each source repository, plus these paths. */
  retainedPaths: Schema.Array(Schema.String),
});
export type DevelopmentEnvironmentCleanupAssessment =
  typeof DevelopmentEnvironmentCleanupAssessment.Type;

export const DevelopmentEnvironmentCleanUpInput = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
  /** The assessment the user confirmed. */
  fingerprint: TrimmedNonEmptyString,
  action: Schema.Literals(["archive", "delete"]),
});
export type DevelopmentEnvironmentCleanUpInput = typeof DevelopmentEnvironmentCleanUpInput.Type;

export const DevelopmentEnvironmentCleanUpResult = Schema.Struct({
  xwingEnvironmentId: XwingEnvironmentId,
  outcome: Schema.Literals(["deleted", "absent", "archived", "alreadyArchived"]),
  releasedHolds: Schema.Array(Schema.String),
  stoppedApplications: Schema.Array(Schema.String),
  retainedPaths: Schema.Array(Schema.String),
});
export type DevelopmentEnvironmentCleanUpResult = typeof DevelopmentEnvironmentCleanUpResult.Type;

export const DevelopmentEnvironmentLifecycleOperation = Schema.Literals([
  "create",
  "attach",
  "repair",
  "restore",
  "list-app-commands",
  "start-app",
  "stop-app",
  "read-app-logs",
  "assess-cleanup",
  "clean-up",
]);
export type DevelopmentEnvironmentLifecycleOperation =
  typeof DevelopmentEnvironmentLifecycleOperation.Type;

const reasonMessages: Record<DevelopmentEnvironmentLifecycleReason, string> = {
  environmentNotFound: "Xwing has no such environment; it may have been deleted.",
  runNotFound: "Xwing has no such app run in this environment.",
  invalidBranch: "Xwing rejected the branch. Choose a task branch; the default branch is reserved.",
  sourceNotFound: "Xwing could not find the project's repository.",
  baseNotFound: "The base ref does not exist in the project's repository.",
  blocked: "Xwing refused: the environment is held, running owned processes or has work to keep.",
  alreadyRunning: "That app is already running with different settings. Stop it first.",
  commandNotDeclared: "The repository does not declare that command in .xwing-env.yaml.",
  unreadableOutput: "Xwing printed output T3 Code cannot read. Xwing may be newer or older.",
  incomplete: "Xwing did not finish.",
  failed: "Xwing failed. The server log has its output.",
  "xwing-unavailable": "Xwing is not installed on this machine or not on the server's PATH.",
  "xwing-unsupported": "This machine's Xwing is too old. Update Xwing.",
  "invalid-input": "Xwing cannot accept this input.",
  "project-missing": "This project no longer exists.",
  "not-a-repository": "This project is not in a Git repository, so Xwing cannot check it out.",
  "assessment-changed": "Something changed since you reviewed this cleanup. Review it again.",
  "cleanup-blocked": "Cleanup is blocked. Review the reasons and try again.",
  "state-unreadable": "T3 Code could not read its threads or schedules for this environment.",
};

/** App-start failures include bounded diagnostics; other operations keep output in the server log. */
export class DevelopmentEnvironmentLifecycleError extends Schema.TaggedError<DevelopmentEnvironmentLifecycleError>()(
  "DevelopmentEnvironmentLifecycleError",
  {
    operation: DevelopmentEnvironmentLifecycleOperation,
    reason: DevelopmentEnvironmentLifecycleReason,
    xwingEnvironmentId: Schema.optional(Schema.String),
    /** Xwing's refusal reasons for a blocked deletion. */
    blockers: Schema.optional(Schema.Array(Schema.String)),
    /** Bounded app-start stderr for diagnosing the declared command. */
    diagnostics: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
  },
) {
  override get message(): string {
    return this.diagnostics
      ? `${reasonMessages[this.reason]}\n${this.diagnostics}`
      : reasonMessages[this.reason];
  }
}
