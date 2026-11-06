import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const WORKSPACE_DEFAULT_GROUP_ID = "ungrouped";
export const WorkspaceGroup = Schema.Struct({
  id: TrimmedNonEmptyString,
  parentId: Schema.NullOr(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
});
export type WorkspaceGroup = typeof WorkspaceGroup.Type;
export const WorkspaceOption = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.String,
});
export const WorkspaceQuestion = Schema.Struct({
  id: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  groupId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  details: Schema.String,
  options: Schema.Array(WorkspaceOption),
  recommendedOptionIds: Schema.Array(TrimmedNonEmptyString),
  recommendation: Schema.String,
  multiSelect: Schema.Boolean,
});
export type WorkspaceQuestion = typeof WorkspaceQuestion.Type;
export const ThreadActionItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  ref: Schema.optional(TrimmedNonEmptyString),
  groupId: Schema.optional(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  details: Schema.String,
  status: Schema.Literals(["open", "deferred", "done"]),
});
export type ThreadActionItem = typeof ThreadActionItem.Type;
export const WorkspaceDesignDocument = Schema.Struct({
  id: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  groupId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  markdown: Schema.String,
  html: Schema.NullOr(Schema.String),
});
export type WorkspaceDesignDocument = typeof WorkspaceDesignDocument.Type;
export const WorkspaceRelatedThread = Schema.Struct({ threadId: ThreadId, why: Schema.String });
export type WorkspaceRelatedThread = typeof WorkspaceRelatedThread.Type;
export const WorkspaceMarkAnnotation = Schema.Struct({
  url: TrimmedNonEmptyString,
  description: Schema.String,
});
export type WorkspaceMarkAnnotation = typeof WorkspaceMarkAnnotation.Type;
export const WorkspaceQuestionAnswer = Schema.Struct({
  selectedOptionIds: Schema.Array(TrimmedNonEmptyString),
  notes: Schema.String,
});
export type WorkspaceQuestionAnswer = typeof WorkspaceQuestionAnswer.Type;
export const WorkspaceUserDraft = Schema.Struct({
  questionAnswers: Schema.Record(Schema.String, WorkspaceQuestionAnswer),
  actionNotes: Schema.Record(Schema.String, Schema.String),
});
export type WorkspaceUserDraft = typeof WorkspaceUserDraft.Type;
export const WorkspaceSubmission = Schema.Struct({
  key: TrimmedNonEmptyString,
  itemIds: Schema.Array(TrimmedNonEmptyString),
  messageId: MessageId,
  submittedAt: IsoDateTime,
  markdown: Schema.String,
});
export type WorkspaceSubmission = typeof WorkspaceSubmission.Type;

export const ThreadWorkspace = Schema.Struct({
  threadId: ThreadId,
  revision: Revision,
  groups: Schema.Array(WorkspaceGroup),
  questions: Schema.Array(WorkspaceQuestion),
  actionItems: Schema.Array(ThreadActionItem),
  designDocuments: Schema.Array(WorkspaceDesignDocument),
  designNotes: Schema.String,
  summaryNotes: Schema.String,
  relatedThreads: Schema.Array(WorkspaceRelatedThread),
  markAnnotations: Schema.Array(WorkspaceMarkAnnotation),
  userDraft: WorkspaceUserDraft,
  submissions: Schema.Array(WorkspaceSubmission),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type ThreadWorkspace = typeof ThreadWorkspace.Type;
export const WorkspacePublished = ThreadWorkspace.mapFields(Struct.omit(["userDraft"]));
export type WorkspacePublished = typeof WorkspacePublished.Type;
export const ThreadWorkspaceCounts = Schema.Struct({
  questions: NonNegativeInt,
  unansweredQuestions: NonNegativeInt,
  actions: NonNegativeInt,
  outstandingActions: NonNegativeInt,
  designs: NonNegativeInt,
  relatedThreads: NonNegativeInt,
});
export type ThreadWorkspaceCounts = typeof ThreadWorkspaceCounts.Type;
export const ThreadWorkspaceGetInput = Schema.Struct({ threadId: ThreadId });
export type ThreadWorkspaceGetInput = typeof ThreadWorkspaceGetInput.Type;
export const ThreadWorkspacePatchInput = Schema.Struct({
  threadId: ThreadId,
  expectedRevision: Revision,
  groups: Schema.optional(Schema.Array(WorkspaceGroup)),
  questions: Schema.optional(Schema.Array(WorkspaceQuestion)),
  actionItems: Schema.optional(Schema.Array(ThreadActionItem)),
  designDocuments: Schema.optional(Schema.Array(WorkspaceDesignDocument)),
  designNotes: Schema.optional(Schema.String),
  summaryNotes: Schema.optional(Schema.String),
  relatedThreads: Schema.optional(Schema.Array(WorkspaceRelatedThread)),
  markAnnotations: Schema.optional(Schema.Array(WorkspaceMarkAnnotation)),
});
export type ThreadWorkspacePatchInput = typeof ThreadWorkspacePatchInput.Type;
export const ThreadWorkspaceSaveDraftInput = Schema.Struct({
  threadId: ThreadId,
  expectedRevision: Revision,
  userDraft: WorkspaceUserDraft,
});
export type ThreadWorkspaceSaveDraftInput = typeof ThreadWorkspaceSaveDraftInput.Type;
export const ThreadWorkspaceSubmitInput = Schema.Struct({
  threadId: ThreadId,
  expectedRevision: Revision,
  itemIds: Schema.Array(TrimmedNonEmptyString),
});
export type ThreadWorkspaceSubmitInput = typeof ThreadWorkspaceSubmitInput.Type;
export const WorkspaceMutation = Schema.Struct({
  kind: Schema.Literals(["group", "question", "action", "design", "relatedThread", "mark"]),
  id: Schema.optional(TrimmedNonEmptyString),
  remove: Schema.optional(Schema.Boolean),
  parentId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  groupId: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  details: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(WorkspaceOption)),
  recommendedOptionIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  recommendation: Schema.optional(Schema.String),
  multiSelect: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Literals(["open", "done"])),
  markdown: Schema.optional(Schema.String),
  html: Schema.optional(Schema.NullOr(Schema.String)),
  threadId: Schema.optional(ThreadId),
  why: Schema.optional(Schema.String),
  url: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
});
export type WorkspaceMutation = typeof WorkspaceMutation.Type;
export const ThreadWorkspaceMutateInput = Schema.Struct({
  threadId: ThreadId,
  expectedRevision: Revision,
  changes: Schema.Array(WorkspaceMutation),
  summaryNotes: Schema.optional(Schema.String),
});
export type ThreadWorkspaceMutateInput = typeof ThreadWorkspaceMutateInput.Type;
export const WorkspaceQuery = Schema.Struct({
  section: Schema.optional(
    Schema.Literals([
      "index",
      "questions",
      "actions",
      "design",
      "summary",
      "threads",
      "marks",
      "all",
    ]),
  ),
  groupId: Schema.optional(TrimmedNonEmptyString),
  itemIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type WorkspaceQuery = typeof WorkspaceQuery.Type;
export const WorkspaceQueryResult = Schema.Struct({
  threadId: ThreadId,
  revision: Revision,
  groups: Schema.Array(WorkspaceGroup),
  items: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      ref: Schema.String,
      groupId: Schema.String,
      kind: Schema.String,
      title: Schema.String,
    }),
  ),
  questions: Schema.optional(Schema.Array(WorkspaceQuestion)),
  actionItems: Schema.optional(Schema.Array(ThreadActionItem)),
  designDocuments: Schema.optional(Schema.Array(WorkspaceDesignDocument)),
  summaryNotes: Schema.optional(Schema.String),
  relatedThreads: Schema.optional(Schema.Array(WorkspaceRelatedThread)),
  markAnnotations: Schema.optional(Schema.Array(WorkspaceMarkAnnotation)),
  submissions: Schema.optional(Schema.Array(WorkspaceSubmission)),
});
export type WorkspaceQueryResult = typeof WorkspaceQueryResult.Type;
export class ThreadWorkspaceError extends Schema.TaggedError<ThreadWorkspaceError>()(
  "ThreadWorkspaceError",
  {
    code: Schema.Literals(["not_found", "invalid", "conflict", "storage", "thread", "send"]),
    message: Schema.String,
    currentRevision: Schema.optional(Revision),
    operation: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
