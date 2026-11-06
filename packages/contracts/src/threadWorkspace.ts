import * as Schema from "effect/Schema";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ThreadActionItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  details: Schema.String,
  status: Schema.Literals(["open", "deferred", "done"]),
});
export type ThreadActionItem = typeof ThreadActionItem.Type;

export const ThreadWorkspace = Schema.Struct({
  threadId: ThreadId,
  revision: Revision,
  actionItems: Schema.Array(ThreadActionItem),
  designNotes: Schema.String,
  summaryNotes: Schema.String,
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type ThreadWorkspace = typeof ThreadWorkspace.Type;

export const ThreadWorkspaceGetInput = Schema.Struct({ threadId: ThreadId });
export type ThreadWorkspaceGetInput = typeof ThreadWorkspaceGetInput.Type;
export const ThreadWorkspacePatchInput = Schema.Struct({
  threadId: ThreadId,
  expectedRevision: Revision,
  actionItems: Schema.optional(Schema.Array(ThreadActionItem)),
  designNotes: Schema.optional(Schema.String),
  summaryNotes: Schema.optional(Schema.String),
});
export type ThreadWorkspacePatchInput = typeof ThreadWorkspacePatchInput.Type;

export class ThreadWorkspaceError extends Schema.TaggedError<ThreadWorkspaceError>()(
  "ThreadWorkspaceError",
  {
    code: Schema.Literals(["not_found", "invalid", "conflict", "storage", "thread"]),
    message: Schema.String,
    currentRevision: Schema.optional(Revision),
    operation: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
