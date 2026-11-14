import * as Schema from "effect/Schema";
import { ProviderInstanceId } from "./providerInstance.ts";
import { IsoDateTime, NonNegativeInt, RunId, ThreadId, TurnItemId } from "./baseSchemas.ts";
import { OrchestrationV2RunStatus } from "./orchestrationV2.ts";

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
  key: Schema.String,
  kind: ThreadLoadEvent.fields.kind,
  label: Schema.String,
  count: NonNegativeInt,
  outputBytes: Schema.NullOr(NonNegativeInt),
  evidence: ThreadLoadEvent.fields.evidence,
});
export type ThreadContextRead = typeof ThreadContextRead.Type;
export const TurnContextRecord = Schema.Struct({
  runId: RunId,
  status: OrchestrationV2RunStatus,
  ordinal: NonNegativeInt,
  model: Schema.String,
  providerInstanceId: ProviderInstanceId,
  startedAt: IsoDateTime,
  instructions: Schema.Array(InstructionFootprint),
  reads: Schema.Array(ThreadContextRead),
  repeatedReads: NonNegativeInt,
  inputTokens: Schema.NullOr(NonNegativeInt),
  cachedInputTokens: Schema.NullOr(NonNegativeInt),
  cachedInputTokensStatus: Schema.Literals(["complete", "partial", "unavailable"]),
  outputTokens: Schema.NullOr(NonNegativeInt),
  usageStatus: Schema.Literals(["complete", "partial", "unavailable"]),
  truncated: Schema.Boolean,
});
export type TurnContextRecord = typeof TurnContextRecord.Type;
export const ThreadContextGetInput = Schema.Struct({
  threadId: ThreadId,
  beforeOrdinal: Schema.optional(NonNegativeInt),
  limit: Schema.optional(NonNegativeInt.check(Schema.isBetween({ minimum: 1, maximum: 20 }))),
  maxBytes: Schema.optional(
    NonNegativeInt.check(Schema.isBetween({ minimum: 4000, maximum: 160000 })),
  ),
  includeInjectedTools: Schema.optional(Schema.Boolean),
});
export type ThreadContextGetInput = typeof ThreadContextGetInput.Type;
export const ThreadContextResult = Schema.Struct({
  threadId: ThreadId,
  records: Schema.Array(TurnContextRecord),
  nextBeforeOrdinal: Schema.NullOr(NonNegativeInt),
  coverage: Schema.String,
});
export type ThreadContextResult = typeof ThreadContextResult.Type;

export const DefaultContextItem = Schema.Struct({
  id: Schema.String,
  category: Schema.Literals(["t3", "app-context", "custom", "files", "tools"]),
  label: Schema.String,
  source: Schema.String,
  delivery: Schema.Literals([
    "every-turn",
    "first-prompt",
    "session-start",
    "first-message",
    "on-demand",
  ]),
  bytes: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  /** False for text that stays out of the default load, such as deferred tool descriptions. */
  counted: Schema.Boolean,
  readable: Schema.Boolean,
  depth: Schema.optional(NonNegativeInt),
  status: Schema.optional(
    Schema.Literals([
      "expected",
      "loaded",
      "not-loaded",
      "unexpected",
      "changed",
      "last-turn-only",
      "outside-home",
      "secret",
    ]),
  ),
});
export type DefaultContextItem = typeof DefaultContextItem.Type;
export const DefaultContextPreview = Schema.Struct({
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  driver: Schema.String,
  model: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  support: Schema.Literals(["exact", "estimate", "unsupported"]),
  filesSupported: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  items: Schema.Array(DefaultContextItem),
  notVisible: Schema.Array(Schema.Struct({ label: Schema.String, why: Schema.String })),
  lastTurn: Schema.NullOr(
    Schema.Struct({
      capturedAt: IsoDateTime,
      model: Schema.String,
      reportsFiles: Schema.Boolean,
    }),
  ),
  estimateMethod: Schema.String,
});
export type DefaultContextPreview = typeof DefaultContextPreview.Type;
export const DefaultContextGetInput = Schema.Struct({
  threadId: ThreadId,
  providerInstanceId: Schema.optional(ProviderInstanceId),
  model: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
});
export type DefaultContextGetInput = typeof DefaultContextGetInput.Type;
export const DefaultContextItemInput = Schema.Struct({
  ...DefaultContextGetInput.fields,
  itemId: Schema.String.check(Schema.isMaxLength(2048)),
});
export type DefaultContextItemInput = typeof DefaultContextItemInput.Type;
export const DefaultContextItemText = Schema.Struct({
  itemId: Schema.String,
  text: Schema.String,
  truncated: Schema.Boolean,
});
export type DefaultContextItemText = typeof DefaultContextItemText.Type;
