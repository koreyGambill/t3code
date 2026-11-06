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
    "Read Workspace when needed, never poll. Default index returns groups and stable item references; select a section, groupId, or itemIds for detail. Only submitted user feedback is visible; private drafts and personal notes are excluded. Omit threadId for this thread.",
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
    "Intentionally maintain the thread's Workspace scratchboard. Read its revision, then batch create/edit/move/delete groups, questions, actions, freeform design (Markdown or sandboxed HTML), related threads, and mark descriptions. Omit change.id to create; use returned id/ref to edit; omitted fields stay unchanged, remove deletes. groupId defaults to Ungrouped. Keep recommendations explicit and unselected; choose multiSelect when needed. Action items hold future work; Summary is thread catch-up, without next steps. Never put secrets here. No chat message or agent run is started; private user answers are never overwritten.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    expectedRevision: ThreadWorkspaceMutateInput.fields.expectedRevision,
    changes: ThreadWorkspaceMutateInput.fields.changes,
    summaryNotes: Schema.optional(Schema.String),
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
