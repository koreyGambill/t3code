import * as Schema from "effect/Schema";
import { ProviderInstanceId } from "./providerInstance.ts";
import { IsoDateTime, NonNegativeInt, RunId, ThreadId, TurnItemId } from "./baseSchemas.ts";

export const InstructionFootprintPart = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  category: Schema.Literals(["t3", "app-context", "custom"]),
  bytes: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
});
export type InstructionFootprintPart = typeof InstructionFootprintPart.Type;
export const InstructionFootprint = Schema.Struct({
  threadId: ThreadId,
  runId: RunId,
  providerInstanceId: ProviderInstanceId,
  driver: Schema.String,
  model: Schema.String,
  capturedAt: IsoDateTime,
  providerTurnOrdinal: Schema.optional(NonNegativeInt),
  attemptId: Schema.optional(Schema.String),
  source: Schema.String,
  parts: Schema.Array(InstructionFootprintPart),
  injectedTools: Schema.optional(Schema.Array(Schema.String)),
  injectedToolCount: Schema.optional(NonNegativeInt),
  truncated: Schema.optional(Schema.Boolean),
  instructionSources: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        bytes: Schema.NullOr(NonNegativeInt),
      }),
    ),
  ),
});
export type InstructionFootprint = typeof InstructionFootprint.Type;

export const ThreadLoadEvent = Schema.Struct({
  itemId: TurnItemId,
  runId: Schema.NullOr(RunId),
  at: IsoDateTime,
  kind: Schema.Literals(["file", "skill", "instructions", "search", "resource", "knowledge"]),
  label: Schema.String,
  paths: Schema.Array(Schema.String),
  toolName: Schema.String,
  evidence: Schema.Literals(["reported", "inferred"]),
  status: Schema.String,
  outputBytes: Schema.NullOr(NonNegativeInt),
  estimatedOutputTokens: Schema.NullOr(NonNegativeInt),
});
export type ThreadLoadEvent = typeof ThreadLoadEvent.Type;
export const ThreadUsagePoint = Schema.Struct({
  runId: Schema.NullOr(RunId),
  turnId: Schema.String,
  ordinal: NonNegativeInt,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  at: IsoDateTime,
  status: Schema.Literals(["complete", "partial", "unavailable"]),
  inputTokens: Schema.NullOr(NonNegativeInt),
  outputTokens: Schema.NullOr(NonNegativeInt),
  cachedInputTokens: Schema.NullOr(NonNegativeInt),
  cacheCreationTokens: Schema.NullOr(NonNegativeInt),
  reasoningTokens: Schema.NullOr(NonNegativeInt),
  localCommand: Schema.Boolean,
  hasSubagents: Schema.Boolean,
  otherInputTokens: Schema.NullOr(NonNegativeInt),
  otherOutputTokens: Schema.NullOr(NonNegativeInt),
});
export type ThreadUsagePoint = typeof ThreadUsagePoint.Type;
export const ThreadInsights = Schema.Struct({
  threadId: ThreadId,
  selectedRunId: Schema.NullOr(RunId),
  runs: Schema.Array(
    Schema.Struct({ id: RunId, ordinal: NonNegativeInt, startedAt: Schema.NullOr(IsoDateTime) }),
  ),
  loads: Schema.Array(ThreadLoadEvent),
  usage: Schema.Array(ThreadUsagePoint),
  footprints: Schema.Array(InstructionFootprint),
  estimateMethod: Schema.String,
});
export type ThreadInsights = typeof ThreadInsights.Type;
export const ThreadInsightsGetInput = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.optional(RunId),
  allRuns: Schema.optional(Schema.Boolean),
});
export type ThreadInsightsGetInput = typeof ThreadInsightsGetInput.Type;
export class ThreadInsightsError extends Schema.TaggedError<ThreadInsightsError>()(
  "ThreadInsightsError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const ThreadContextRead = Schema.Struct({
  kind: ThreadLoadEvent.fields.kind,
  label: Schema.String,
  count: NonNegativeInt,
  outputBytes: Schema.NullOr(NonNegativeInt),
  evidence: ThreadLoadEvent.fields.evidence,
});
export type ThreadContextRead = typeof ThreadContextRead.Type;
export const TurnContextRecord = Schema.Struct({
  runId: RunId,
  ordinal: NonNegativeInt,
  model: Schema.String,
  providerInstanceId: ProviderInstanceId,
  startedAt: IsoDateTime,
  instructions: Schema.Array(InstructionFootprint),
  reads: Schema.Array(ThreadContextRead),
  repeatedReads: NonNegativeInt,
  inputTokens: Schema.NullOr(NonNegativeInt),
  cachedInputTokens: Schema.NullOr(NonNegativeInt),
  outputTokens: Schema.NullOr(NonNegativeInt),
  usageStatus: Schema.Literals(["complete", "partial", "unavailable"]),
  truncated: Schema.Boolean,
});
export type TurnContextRecord = typeof TurnContextRecord.Type;
export const ThreadContextGetInput = Schema.Struct({
  threadId: ThreadId,
  beforeOrdinal: Schema.optional(NonNegativeInt),
  limit: Schema.optional(NonNegativeInt.check(Schema.isBetween({ minimum: 1, maximum: 20 }))),
});
export type ThreadContextGetInput = typeof ThreadContextGetInput.Type;
export const ThreadContextResult = Schema.Struct({
  threadId: ThreadId,
  records: Schema.Array(TurnContextRecord),
  nextBeforeOrdinal: Schema.NullOr(NonNegativeInt),
  coverage: Schema.String,
});
export type ThreadContextResult = typeof ThreadContextResult.Type;
