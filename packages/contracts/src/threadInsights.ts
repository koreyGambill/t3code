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
});
export type InstructionFootprint = typeof InstructionFootprint.Type;

export const ThreadLoadEvent = Schema.Struct({
  itemId: TurnItemId,
  runId: Schema.NullOr(RunId),
  at: IsoDateTime,
  kind: Schema.Literals(["file", "skill", "instructions", "search", "resource"]),
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
