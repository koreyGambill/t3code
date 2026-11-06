import {
  OrchestratorMcpFailure,
  ReviewContent,
  ReviewId,
  ReviewPublished,
  ThreadId,
  ThreadActionItem,
  ThreadWorkspace,
  ThreadWorkspacePatchInput,
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
    "Present organized multi-question decisions in the thread's Workspace Questions section: sections, questions, options, and recommendations. The user can save answers and notes, defer questions, and send feedback later. Returns immediately; continue your work. Omit threadId for this thread. Workspace also keeps Action items, Design notes, and Summary. Use chat for a simple question.",
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
    "Read this thread's persistent Workspace: Action items, Design notes, and Summary. Questions are published with review_create; review_read returns only submitted answers. Omit threadId for this thread. Read the revision before updating, and preserve unrelated items and notes. Read when needed; do not poll.",
  parameters: Schema.Struct({ threadId: Schema.optional(ThreadId) }),
  success: ThreadWorkspace,
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
    "Update this thread's persistent Workspace without blocking your work. Record outstanding needs from the user as Action items instead of repeating reminders in chat; keep Design notes and Summary current. Read first, pass expectedRevision, use stable action ids, and preserve unrelated fields and items. Provided fields replace their saved values; omitted fields stay unchanged. Deferred means postponed, not done or approved. Use review_create for structured Questions. Omit threadId for this thread. Does not send a chat message or start an agent run.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    expectedRevision: ThreadWorkspacePatchInput.fields.expectedRevision,
    actionItems: Schema.optional(Schema.Array(ThreadActionItem)),
    designNotes: Schema.optional(Schema.String),
    summaryNotes: Schema.optional(Schema.String),
  }),
  success: ThreadWorkspace,
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
