import {
  OrchestratorMcpFailure,
  ReviewContent,
  ReviewId,
  ReviewPublished,
  ThreadId,
  WorkspaceQuery,
  WorkspaceQueryResult,
  ThreadWorkspaceMutateInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import { ThreadWorkspace as ThreadWorkspaceService } from "../../../threadWorkspace/ThreadWorkspace.ts";
import * as ReviewArtifacts from "../../../reviewArtifacts/ReviewArtifacts.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  ReviewArtifacts.ReviewArtifacts,
  ThreadWorkspaceService,
  ThreadManagement.ThreadManagementService,
  McpInvocationContext.McpInvocationContext,
];

// Like HTML publishing, this changes the thread's presentation rather than its filesystem.
const ReviewCreateTool = Tool.make("review_create", {
  description:
    "Publish organized questions in the thread's Workspace Questions section when the user asks to workspace them for later or a durable structured review is useful. Add context, options, and recommendations where useful. Ordinary questions and interviews can stay in chat. The user can save answers and notes and send feedback later. Returns immediately; continue independent work. Omit threadId for this thread. Secrets use request_secret.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    content: ReviewContent,
  }),
  success: Schema.Struct({ reviewId: ReviewId, threadId: ThreadId }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Publish a review")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

const ReviewReadTool = Tool.make("review_read", {
  description:
    "Read a published review and its last submitted feedback by reviewId. Unfinished user drafts stay private until the user sends them. Read when you need the review; do not poll for answers.",
  parameters: Schema.Struct({ reviewId: ReviewId }),
  success: ReviewPublished,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read a review")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const WorkspaceReadTool = Tool.make("thread_workspace_read", {
  description:
    "Read Workspace when needed, never poll. Default index returns groups and stable item references; select a section, groupId, itemIds, or status (question open/answered; action open/deferred/done; work queued/active/blocked/done/landed) for detail. Questions and actions include submitted: the answer and notes the user sent to chat. section work lists your Agent work with verifications; filter userQa pending/passed/issues for the human QA queue. section record is the durable work record: your Agent work (open plus recent done), the user's open Actions, active decisions, context, and Summary. Read it after compaction, resume, or handoff before continuing; your provider summary may omit it. Only submitted user feedback is visible; private drafts and personal notes are excluded. Omit threadId for this thread.",
  parameters: Schema.Struct({ threadId: Schema.optional(ThreadId), ...WorkspaceQuery.fields }),
  success: WorkspaceQueryResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read thread workspace")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const WorkspaceUpdateTool = Tool.make("thread_workspace_update", {
  description:
    "Intentionally maintain the thread's Workspace scratchboard. Read its revision, then batch create/edit/move/delete groups, questions, actions, work, decisions, context, freeform design (Markdown or sandboxed HTML), related threads, and mark descriptions. kind mark with name and contextSource ({} is this thread's latest finished turn; or threadId, runId, checkpointId) pins a context point for `delegate_task` context.mark; renaming keeps its url and point. Omit change.id to create; use returned id/ref to edit; omitted fields stay unchanged, remove deletes. Edits merge per field: a stale revision fails only when the same field changed since, so reread and reapply just that. kind action is the user's own to-do list; never put your work there. kind work is your list of thread-level commitments you own: status queued/active/blocked/done/landed, title, remaining checks, source (who asked, where), and when finished changed, qaSteps (short human QA steps), checks (what you ran), userQa pending; keep finished items as your record and keep native plan steps out of it. userQa is the human's pass/issues and never blocks authorized landing. kind verification records evidence on work: workId, verifier, method executed (tests run or client clicked) or source-review, details, testedRevision, result pass/fail/partial, gaps, evidence; your own thread's verification is self-report, not independent proof. kind decision: title, rationale, source, decidedBy user only when the user made the call, else agent. Use status accepted for a choice already made by either actor, or proposed for an unresolved choice. Routine agent decisions do not need user acceptance. kind context: category context/preference/constraint for durable thread facts. For a substantive design or related items, reuse a relevant group or create a concise topical group first, then add items using its returned id and revision. Use Ungrouped intentionally for standalone or uncategorized items. Omitted groupId preserves an existing item's group and puts new items in Ungrouped. Keep recommendations explicit and unselected; choose multiSelect when needed. Summary is thread catch-up, without next steps. `childPreamble` is standing context prepended to future `delegate_task` briefs from this thread. Never put secrets here. No chat message or agent run is started; private user answers are never overwritten. Returns the new revision and only changed items and groups; pass fullIndex for the whole index.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    expectedRevision: ThreadWorkspaceMutateInput.fields.expectedRevision,
    changes: ThreadWorkspaceMutateInput.fields.changes,
    summaryNotes: Schema.optional(Schema.String),
    childPreamble: ThreadWorkspaceMutateInput.fields.childPreamble,
    fullIndex: ThreadWorkspaceMutateInput.fields.fullIndex,
  }),
  success: WorkspaceQueryResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Update thread workspace")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const ReviewToolkit = Toolkit.make(
  ReviewCreateTool,
  ReviewReadTool,
  WorkspaceReadTool,
  WorkspaceUpdateTool,
);
