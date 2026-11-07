import * as Schema from "effect/Schema";
import { ThreadId, IsoDateTime } from "./baseSchemas.ts";
import { XwingEnvironmentId } from "./xwingEnvironments.ts";

export const ThreadMark = Schema.Struct({
  /** A web URL, or for an in-app link a stable identifier to copy and search by. */
  url: Schema.String,
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
