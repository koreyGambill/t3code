import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import {
  CheckpointId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  RunId,
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
// Set by the server from the writing connection, never by the writer's own claim.
export const WorkspaceActor = Schema.Literals(["user", "agent"]);
export type WorkspaceActor = typeof WorkspaceActor.Type;
export const ThreadActionStatus = Schema.Literals(["open", "deferred", "done"]);
export const ThreadActionItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  ref: Schema.optional(TrimmedNonEmptyString),
  groupId: Schema.optional(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  details: Schema.String,
  status: ThreadActionStatus,
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
// The agent's own commitments, kept apart from the user's Action items.
export const AgentWorkStatus = Schema.Literals(["queued", "active", "blocked", "done", "landed"]);
// Human QA is tracked apart from the agent's status and never gates authorized landing.
export const UserQaStatus = Schema.Literals(["none", "pending", "passed", "issues"]);
export const AgentWorkItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: AgentWorkStatus,
  remaining: Schema.String,
  source: Schema.String,
  details: Schema.String,
  changed: Schema.String,
  qaSteps: Schema.String,
  checks: Schema.String,
  userQa: UserQaStatus,
  userQaNote: Schema.String,
  completedAt: Schema.NullOr(IsoDateTime),
  recordedByThreadId: Schema.NullOr(ThreadId),
});
export type AgentWorkItem = typeof AgentWorkItem.Type;
export const WorkVerification = Schema.Struct({
  id: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  workId: TrimmedNonEmptyString,
  verifier: Schema.String,
  method: Schema.Literals(["executed", "source-review"]),
  details: Schema.String,
  testedRevision: Schema.String,
  result: Schema.Literals(["pass", "fail", "partial"]),
  gaps: Schema.String,
  evidence: Schema.String,
  at: IsoDateTime,
  recordedBy: WorkspaceActor,
  recordedByThreadId: Schema.NullOr(ThreadId),
});
export type WorkVerification = typeof WorkVerification.Type;
/** Independent means executed by a different thread than the one that recorded the work. */
export function isIndependentVerification(
  work: Pick<AgentWorkItem, "recordedByThreadId">,
  verification: Pick<WorkVerification, "method" | "recordedByThreadId">,
): boolean {
  return (
    verification.method === "executed" &&
    work.recordedByThreadId !== null &&
    verification.recordedByThreadId !== null &&
    verification.recordedByThreadId !== work.recordedByThreadId
  );
}
export const ThreadWorkspaceListWorkInput = Schema.Struct({
  userQa: Schema.optional(Schema.Array(UserQaStatus)),
});
export type ThreadWorkspaceListWorkInput = typeof ThreadWorkspaceListWorkInput.Type;
export const ThreadWorkspaceWorkEntry = Schema.Struct({
  threadId: ThreadId,
  threadTitle: Schema.String,
  revision: Revision,
  item: AgentWorkItem,
  verifications: Schema.Array(WorkVerification),
});
export type ThreadWorkspaceWorkEntry = typeof ThreadWorkspaceWorkEntry.Type;
export const WorkspaceDecisionStatus = Schema.Literals(["proposed", "accepted", "superseded"]);
export const WorkspaceDecision = Schema.Struct({
  id: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  groupId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  rationale: Schema.String,
  decidedBy: WorkspaceActor,
  status: WorkspaceDecisionStatus,
  source: Schema.String,
  recordedBy: WorkspaceActor,
});
export type WorkspaceDecision = typeof WorkspaceDecision.Type;
export const WorkspaceContextCategory = Schema.Literals(["context", "preference", "constraint"]);
export const WorkspaceContextItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  groupId: TrimmedNonEmptyString,
  category: WorkspaceContextCategory,
  title: TrimmedNonEmptyString,
  details: Schema.String,
  source: Schema.String,
  recordedBy: WorkspaceActor,
});
export type WorkspaceContextItem = typeof WorkspaceContextItem.Type;
export const WorkspaceRelatedThread = Schema.Struct({ threadId: ThreadId, why: Schema.String });
export type WorkspaceRelatedThread = typeof WorkspaceRelatedThread.Type;
export const WorkspaceContextPoint = Schema.Struct({
  threadId: ThreadId,
  runId: RunId,
  checkpointId: Schema.optional(CheckpointId),
});
export type WorkspaceContextPoint = typeof WorkspaceContextPoint.Type;
/** With `contextSource` this is a context mark: a named, fixed point a delegate can start from. */
export const WorkspaceMarkAnnotation = Schema.Struct({
  url: TrimmedNonEmptyString,
  description: Schema.String,
  name: Schema.optional(TrimmedNonEmptyString),
  contextSource: Schema.optional(WorkspaceContextPoint),
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
  agentWork: Schema.Array(AgentWorkItem).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  verifications: Schema.Array(WorkVerification).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  decisions: Schema.Array(WorkspaceDecision).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  contextItems: Schema.Array(WorkspaceContextItem).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  designNotes: Schema.String,
  summaryNotes: Schema.String,
  // Prepended to every delegate_task this thread starts.
  childPreamble: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
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
  agentWork: NonNegativeInt,
  openAgentWork: NonNegativeInt,
  pendingQa: NonNegativeInt,
  records: NonNegativeInt,
});
export type ThreadWorkspaceCounts = typeof ThreadWorkspaceCounts.Type;
export const ThreadWorkspaceGetInput = Schema.Struct({ threadId: ThreadId });
export type ThreadWorkspaceGetInput = typeof ThreadWorkspaceGetInput.Type;
// expectedRevision is the revision the writer last saw; only changed entries need sending.
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
  kind: Schema.Literals([
    "group",
    "question",
    "action",
    "design",
    "work",
    "verification",
    "decision",
    "context",
    "relatedThread",
    "mark",
  ]),
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
  status: Schema.optional(
    Schema.Union([ThreadActionStatus, AgentWorkStatus, WorkspaceDecisionStatus]),
  ),
  changed: Schema.optional(Schema.String),
  qaSteps: Schema.optional(Schema.String),
  checks: Schema.optional(Schema.String),
  userQa: Schema.optional(UserQaStatus),
  userQaNote: Schema.optional(Schema.String),
  workId: Schema.optional(TrimmedNonEmptyString),
  verifier: Schema.optional(Schema.String),
  method: Schema.optional(WorkVerification.fields.method),
  testedRevision: Schema.optional(Schema.String),
  result: Schema.optional(WorkVerification.fields.result),
  gaps: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.String),
  remaining: Schema.optional(Schema.String),
  rationale: Schema.optional(Schema.String),
  decidedBy: Schema.optional(WorkspaceActor),
  category: Schema.optional(WorkspaceContextCategory),
  source: Schema.optional(Schema.String),
  markdown: Schema.optional(Schema.String),
  html: Schema.optional(Schema.NullOr(Schema.String)),
  threadId: Schema.optional(ThreadId),
  why: Schema.optional(Schema.String),
  url: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  name: Schema.optional(TrimmedNonEmptyString),
  // Without runId or checkpointId, the thread's latest finished turn when the mark is made.
  contextSource: Schema.optional(
    Schema.Struct({
      threadId: Schema.optional(ThreadId),
      runId: Schema.optional(RunId),
      checkpointId: Schema.optional(CheckpointId),
    }),
  ),
});
export type WorkspaceMutation = typeof WorkspaceMutation.Type;
export const ThreadWorkspaceMutateInput = Schema.Struct({
  threadId: ThreadId,
  expectedRevision: Revision,
  changes: Schema.Array(WorkspaceMutation),
  summaryNotes: Schema.optional(Schema.String),
  childPreamble: Schema.optional(Schema.String),
  fullIndex: Schema.optional(Schema.Boolean),
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
      "work",
      "record",
      "threads",
      "marks",
      "all",
    ]),
  ),
  groupId: Schema.optional(TrimmedNonEmptyString),
  itemIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  status: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  userQa: Schema.optional(Schema.Array(UserQaStatus)),
});
export type WorkspaceQuery = typeof WorkspaceQuery.Type;
// What the user sent to chat for an item; never an unsent draft.
export const WorkspaceSubmittedFeedback = Schema.Struct({
  messageId: MessageId,
  submittedAt: IsoDateTime,
  text: Schema.String,
});
const submittedField = { submitted: Schema.optional(WorkspaceSubmittedFeedback) };
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
      status: Schema.optional(Schema.String),
    }),
  ),
  removedIds: Schema.optional(Schema.Array(Schema.String)),
  questions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        ...WorkspaceQuestion.fields,
        status: Schema.Literals(["open", "answered"]),
        ...submittedField,
      }),
    ),
  ),
  actionItems: Schema.optional(
    Schema.Array(Schema.Struct({ ...ThreadActionItem.fields, ...submittedField })),
  ),
  verifications: Schema.optional(Schema.Array(WorkVerification)),
  designDocuments: Schema.optional(Schema.Array(WorkspaceDesignDocument)),
  agentWork: Schema.optional(Schema.Array(AgentWorkItem)),
  decisions: Schema.optional(Schema.Array(WorkspaceDecision)),
  contextItems: Schema.optional(Schema.Array(WorkspaceContextItem)),
  summaryNotes: Schema.optional(Schema.String),
  childPreamble: Schema.optional(Schema.String),
  relatedThreads: Schema.optional(Schema.Array(WorkspaceRelatedThread)),
  markAnnotations: Schema.optional(Schema.Array(WorkspaceMarkAnnotation)),
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
