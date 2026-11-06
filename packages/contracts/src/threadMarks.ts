import * as Schema from "effect/Schema";
import { ThreadId, IsoDateTime } from "./baseSchemas.ts";

export const ThreadMark = Schema.Struct({
  url: Schema.String,
  service: Schema.String,
  timestamp: IsoDateTime,
  description: Schema.String,
});
export type ThreadMark = typeof ThreadMark.Type;
export const ThreadMarksGetInput = Schema.Struct({ threadId: ThreadId });
export type ThreadMarksGetInput = typeof ThreadMarksGetInput.Type;
export class ThreadMarksError extends Schema.TaggedError<ThreadMarksError>()("ThreadMarksError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
