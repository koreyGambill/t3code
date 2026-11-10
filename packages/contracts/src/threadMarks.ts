import * as Schema from "effect/Schema";
import {
  ThreadId,
  IsoDateTime,
  RunId,
  CheckpointId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { XwingEnvironmentId } from "./xwingEnvironments.ts";

export const ThreadMarkAnnotation = Schema.Struct({
  url: TrimmedNonEmptyString,
  description: Schema.String,
  name: Schema.optional(TrimmedNonEmptyString),
  contextSource: Schema.optional(
    Schema.Struct({
      threadId: ThreadId,
      runId: RunId,
      checkpointId: Schema.optional(CheckpointId),
    }),
  ),
});
export type ThreadMarkAnnotation = typeof ThreadMarkAnnotation.Type;
export const ThreadMarksAnnotateInput = Schema.Struct({
  threadId: ThreadId,
  annotation: ThreadMarkAnnotation,
});
export type ThreadMarksAnnotateInput = typeof ThreadMarksAnnotateInput.Type;
export const ThreadMark = Schema.Struct({
  /** A web URL, or for an in-app link a stable identifier to copy and search by. */
  url: Schema.String,
  name: ThreadMarkAnnotation.fields.name,
  contextSource: ThreadMarkAnnotation.fields.contextSource,
  service: Schema.String,
  timestamp: IsoDateTime,
  description: Schema.String,
  /** An in-app destination on the machine that owns the thread. Absent for web links. */
  link: Schema.optional(
    Schema.Struct({
      type: Schema.Literal("xwing_environment"),
      xwingEnvironmentId: XwingEnvironmentId,
    }),
  ),
});
export type ThreadMark = typeof ThreadMark.Type;
export const ThreadMarksGetInput = Schema.Struct({ threadId: ThreadId });
export type ThreadMarksGetInput = typeof ThreadMarksGetInput.Type;
export class ThreadMarksError extends Schema.TaggedError<ThreadMarksError>()("ThreadMarksError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
