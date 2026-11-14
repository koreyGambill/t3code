import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProjectId, ThreadId, MessageId, ScheduledTaskId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ScheduledTaskSchedule } from "./scheduledTask.ts";

export const MonitoringProfileId = TrimmedNonEmptyString.pipe(Schema.brand("MonitoringProfileId"));
export type MonitoringProfileId = typeof MonitoringProfileId.Type;
export const MonitoringFindingId = TrimmedNonEmptyString.pipe(Schema.brand("MonitoringFindingId"));
export type MonitoringFindingId = typeof MonitoringFindingId.Type;
export const MonitoringRule = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  instructions: TrimmedNonEmptyString,
});
export type MonitoringRule = typeof MonitoringRule.Type;
export const MonitoringTargets = Schema.Struct({
  state: Schema.Literals(["active", "closed", "all"]),
  threadIds: Schema.Array(ThreadId),
  includeChildren: Schema.Boolean,
  minAgeMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  updatedWithinMs: Schema.NullOr(Schema.Number.check(Schema.isGreaterThan(0))),
});
export const MonitoringProfileInput = Schema.Struct({
  id: Schema.optional(MonitoringProfileId),
  title: TrimmedNonEmptyString,
  kind: Schema.optional(Schema.Literals(["standards", "context-review"])),
  enabled: Schema.Boolean,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  schedule: ScheduledTaskSchedule.check(
    Schema.makeFilter(
      // Watchers react to turn ends through `turnEnd` until they fold into event-triggered tasks.
      (schedule) =>
        schedule.type !== "webhook" &&
        schedule.type !== "event" &&
        (schedule.type !== "interval" || !schedule.idleCheckin),
    ),
  ),
  turnEnd: Schema.optional(
    Schema.Struct({
      cooldownMs: Schema.optional(
        Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(60_000)),
      ),
      allProjects: Schema.optional(Schema.Boolean),
    }),
  ),
  delivery: Schema.optional(Schema.Literals(["thread-or-alert", "alerts"])),
  instructionFiles: Schema.optional(
    Schema.Array(
      TrimmedNonEmptyString.check(
        Schema.isMaxLength(4096),
        Schema.makeFilter(
          (path) =>
            path.startsWith("/") ||
            path.startsWith("~/") ||
            /^[A-Za-z]:[\\/]/.test(path) ||
            path.startsWith("\\\\"),
        ),
      ),
    ).check(Schema.isMaxLength(32)),
  ),
  includeProjectAgents: Schema.optional(Schema.Boolean),
  targets: MonitoringTargets,
  rules: Schema.Array(MonitoringRule).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
});
export type MonitoringProfileInput = typeof MonitoringProfileInput.Type;
export const MonitoringProfile = Schema.Struct({
  ...MonitoringProfileInput.fields,
  id: MonitoringProfileId,
  scheduledTaskId: ScheduledTaskId,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MonitoringProfile = typeof MonitoringProfile.Type;
export const MonitoringEvidence = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  excerpt: TrimmedNonEmptyString.check(Schema.isMaxLength(1000)),
});
export type MonitoringEvidence = typeof MonitoringEvidence.Type;
const MonitoringFindingContent = Schema.Struct({
  threadId: ThreadId,
  ruleId: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(300)),
  detail: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  confidence: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  evidence: Schema.Array(MonitoringEvidence).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
});
export const MonitoringReviewOutput = Schema.Struct({
  findings: Schema.Array(MonitoringFindingContent).check(Schema.isMaxLength(32)),
});
export type MonitoringReviewOutput = typeof MonitoringReviewOutput.Type;
export const MonitoringDisposition = Schema.Literals([
  "open",
  "acknowledged",
  "dismissed",
  "resolved",
]);
export const MonitoringExchange = Schema.Struct({
  id: TrimmedNonEmptyString,
  at: IsoDateTime,
  role: Schema.Literals(["monitor", "agent", "user"]),
  text: TrimmedNonEmptyString,
});
export type MonitoringExchange = typeof MonitoringExchange.Type;
export const MonitoringFinding = Schema.Struct({
  ...MonitoringFindingContent.fields,
  ruleSnapshot: Schema.optional(MonitoringRule),
  id: MonitoringFindingId,
  profileId: MonitoringProfileId,
  runId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  disposition: MonitoringDisposition,
  readAt: Schema.NullOr(IsoDateTime),
  snoozedUntil: Schema.NullOr(IsoDateTime),
  exchanges: Schema.Array(MonitoringExchange),
  outcome: Schema.NullOr(Schema.String),
  sentToThread: Schema.optional(Schema.Struct({ messageId: MessageId, at: IsoDateTime })),
});
export type MonitoringFinding = typeof MonitoringFinding.Type;
export const MonitoringRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  profileId: MonitoringProfileId,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  status: Schema.Literals(["running", "succeeded", "failed"]),
  error: Schema.NullOr(Schema.String),
  targetThreadIds: Schema.Array(ThreadId),
  costUsd: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))),
  budgetUsd: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))),
  profile: MonitoringProfile,
});
export type MonitoringRun = typeof MonitoringRun.Type;
export const MonitoringListInput = Schema.Struct({});
export const MonitoringListResult = Schema.Struct({
  profiles: Schema.Array(MonitoringProfile),
  findings: Schema.Array(MonitoringFinding),
  runs: Schema.Array(MonitoringRun),
});
export type MonitoringListResult = typeof MonitoringListResult.Type;
export const MonitoringUpsertInput = MonitoringProfileInput;
export type MonitoringUpsertInput = typeof MonitoringUpsertInput.Type;
export const MonitoringProfileResult = Schema.Struct({ profile: MonitoringProfile });
export const MonitoringSetEnabledInput = Schema.Struct({
  id: MonitoringProfileId,
  enabled: Schema.Boolean,
});
export const MonitoringRunNowInput = Schema.Struct({ id: MonitoringProfileId });
export const MonitoringRunResult = Schema.Struct({ run: MonitoringRun });
export const MonitoringSetDispositionInput = Schema.Struct({
  id: MonitoringFindingId,
  disposition: MonitoringDisposition,
  readAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  snoozedUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  outcome: Schema.optional(Schema.NullOr(Schema.String)),
});
export type MonitoringSetDispositionInput = typeof MonitoringSetDispositionInput.Type;
export const MonitoringFindingResult = Schema.Struct({ finding: MonitoringFinding });
export class MonitoringError extends Schema.TaggedError<MonitoringError>()("MonitoringError", {
  operation: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Monitoring ${this.operation} failed.`;
  }
}

export const MonitoringRespondInput = Schema.Struct({
  findingId: MonitoringFindingId,
  responseId: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
});
export type MonitoringRespondInput = typeof MonitoringRespondInput.Type;
export const MonitoringRespondResult = MonitoringFindingResult;

export const MonitoringAssessment = Schema.Struct({
  outcome: Schema.Literals(["corrected", "accepted_explanation", "unresolved", "unverified"]),
  reason: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  evidence: Schema.Array(MonitoringEvidence).check(Schema.isMaxLength(8)),
});
export type MonitoringAssessment = typeof MonitoringAssessment.Type;

export const MonitoringStatusResult = Schema.Struct({ unreadCount: Schema.Number });
export type MonitoringStatusResult = typeof MonitoringStatusResult.Type;
