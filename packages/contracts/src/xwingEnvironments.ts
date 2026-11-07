import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

// CLI diagnostics stay on the server because stderr can include repository credentials.
export const XwingDiagnosticCause = Schema.Null.pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transform({
      decode: (): unknown => undefined,
      encode: () => null,
    }),
  ),
);

/**
 * Xwing's own id for a development environment. It is unrelated to a T3
 * `EnvironmentId`, which names the server machine that owns the environment.
 */
export const XwingEnvironmentId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8,64}$/)).pipe(
  Schema.brand("XwingEnvironmentId"),
);
export type XwingEnvironmentId = typeof XwingEnvironmentId.Type;

export const XwingEnvironmentStatus = Schema.Literals(["active", "archived"]);
export type XwingEnvironmentStatus = typeof XwingEnvironmentStatus.Type;

export const XwingRepositorySummary = Schema.Struct({
  name: Schema.String,
  /** The source checkout Xwing recorded when the repository was added. */
  sourcePath: Schema.String,
  /** The worktree, or for an archived environment the archived copy. */
  path: Schema.String,
  branch: Schema.String,
  /**
   * The checkout directory existed when the server listed it. Always false in an
   * archived environment, whose copy is not a checkout a thread can run in.
   */
  present: Schema.Boolean,
});
export type XwingRepositorySummary = typeof XwingRepositorySummary.Type;

/** One entry of Xwing's environment catalog; it carries no Git state or health. */
export const XwingEnvironmentSummary = Schema.Struct({
  id: XwingEnvironmentId,
  /** The `<n>` in `~/.xwing/envs/<n>`; absent for older environments kept in place. */
  number: Schema.optional(Schema.Number),
  name: Schema.String,
  ticket: Schema.optional(Schema.String),
  status: XwingEnvironmentStatus,
  rootPath: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archivedAt: Schema.optional(Schema.String),
  repositories: Schema.Array(XwingRepositorySummary),
});
export type XwingEnvironmentSummary = typeof XwingEnvironmentSummary.Type;

export const XwingRepositoryDetail = Schema.Struct({
  name: Schema.String,
  sourcePath: Schema.String,
  path: Schema.String,
  branch: Schema.String,
  base: Schema.String,
  headRevision: Schema.optional(Schema.String),
  ahead: Schema.Number,
  behind: Schema.Number,
  dirty: Schema.Boolean,
  published: Schema.Boolean,
  stale: Schema.Boolean,
  refreshResult: Schema.optional(Schema.String),
  refreshReason: Schema.optional(Schema.String),
});
export type XwingRepositoryDetail = typeof XwingRepositoryDetail.Type;

export const XwingHealthCheck = Schema.Struct({
  status: Schema.String,
  code: Schema.String,
  repository: Schema.optional(Schema.String),
  message: Schema.String,
});
export type XwingHealthCheck = typeof XwingHealthCheck.Type;

export const XwingApplicationRun = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  repository: Schema.String,
  /** Process state as Xwing reports it; `running` does not imply the app is ready. */
  status: Schema.String,
  pid: Schema.optional(Schema.Number),
  exitCode: Schema.optional(Schema.Number),
  startedAt: Schema.optional(Schema.String),
  urls: Schema.Record(Schema.String, Schema.String),
});
export type XwingApplicationRun = typeof XwingApplicationRun.Type;

export const XwingAgentSession = Schema.Struct({
  harness: Schema.String,
  session: Schema.optional(Schema.String),
  firstSeen: Schema.String,
  lastSeen: Schema.String,
});
export type XwingAgentSession = typeof XwingAgentSession.Type;

export const XwingEnvironmentDetail = Schema.Struct({
  id: XwingEnvironmentId,
  number: Schema.optional(Schema.Number),
  name: Schema.String,
  ticket: Schema.optional(Schema.String),
  rootPath: Schema.String,
  status: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lifecycle: Schema.optional(
    Schema.Struct({
      action: Schema.String,
      dueAt: Schema.optional(Schema.String),
      due: Schema.Boolean,
      blocked: Schema.optional(Schema.String),
    }),
  ),
  repositories: Schema.Array(XwingRepositoryDetail),
  health: Schema.Struct({
    status: Schema.String,
    checks: Schema.Array(XwingHealthCheck),
  }),
  /** Most recent retained runs first, at most Xwing's default page. */
  applications: Schema.Struct({
    runs: Schema.Array(XwingApplicationRun),
    truncated: Schema.Boolean,
  }),
  agentSessions: Schema.Array(XwingAgentSession),
});
export type XwingEnvironmentDetail = typeof XwingEnvironmentDetail.Type;

export const XwingEnvironmentsInspectInput = Schema.Struct({
  id: XwingEnvironmentId,
});
export type XwingEnvironmentsInspectInput = typeof XwingEnvironmentsInspectInput.Type;

export const XwingOperation = Schema.Literals(["list", "inspect", "listApplications"]);
export type XwingOperation = typeof XwingOperation.Type;

export class XwingUnavailableError extends Schema.TaggedError<XwingUnavailableError>()(
  "XwingUnavailableError",
  { command: Schema.String, cause: XwingDiagnosticCause },
) {
  override get message(): string {
    return `Xwing is not available: '${this.command}' could not be started. Install Xwing or put it on the server's PATH.`;
  }
}

export class XwingUnsupportedError extends Schema.TaggedError<XwingUnsupportedError>()(
  "XwingUnsupportedError",
  { command: Schema.String, cause: XwingDiagnosticCause },
) {
  override get message(): string {
    return `Xwing '${this.command}' is too old to list environments: T3 Code needs 'xwing env list --sessions'. Update Xwing on this machine.`;
  }
}

export class XwingEnvironmentNotFoundError extends Schema.TaggedError<XwingEnvironmentNotFoundError>()(
  "XwingEnvironmentNotFoundError",
  { environmentId: Schema.String },
) {
  override get message(): string {
    return `Xwing has no active environment ${this.environmentId}; it may have been archived or removed.`;
  }
}

export class XwingCommandError extends Schema.TaggedError<XwingCommandError>()(
  "XwingCommandError",
  {
    operation: XwingOperation,
    exitCode: Schema.NullOr(Schema.Number),
    cause: XwingDiagnosticCause,
  },
) {
  override get message(): string {
    return this.exitCode === null
      ? `Xwing ${this.operation} did not complete.`
      : `Xwing ${this.operation} exited with code ${this.exitCode}.`;
  }
}

export class XwingOutputError extends Schema.TaggedError<XwingOutputError>()("XwingOutputError", {
  operation: XwingOperation,
  line: Schema.Number,
  cause: XwingDiagnosticCause,
}) {
  override get message(): string {
    return `Xwing ${this.operation} printed output this server cannot read (line ${this.line}); Xwing may be newer or older than expected.`;
  }
}

export const XwingListError = Schema.Union([
  XwingUnavailableError,
  XwingUnsupportedError,
  XwingCommandError,
  XwingOutputError,
]);
export type XwingListError = typeof XwingListError.Type;

export const XwingInspectError = Schema.Union([
  XwingUnavailableError,
  XwingEnvironmentNotFoundError,
  XwingCommandError,
  XwingOutputError,
]);
export type XwingInspectError = typeof XwingInspectError.Type;
