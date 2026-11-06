import {
  OrchestratorMcpFailure,
  type ReviewArtifactError,
  type ThreadWorkspaceError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ThreadWorkspace } from "../../../threadWorkspace/ThreadWorkspace.ts";
import * as ReviewArtifacts from "../../../reviewArtifacts/ReviewArtifacts.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread } from "../../threadAccess.ts";
import { ReviewToolkit } from "./tools.ts";

const failure = (error: ReviewArtifactError | ThreadWorkspaceError) =>
  new OrchestratorMcpFailure({
    code: error.code === "storage" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

export const layer = McpToolAccess.toLayer(ReviewToolkit, {
  thread_workspace_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId);
      const workspace = yield* ThreadWorkspace;
      return yield* workspace
        .query({ ...input, threadId: projection.thread.id })
        .pipe(Effect.mapError(failure));
    }),
  ),
  thread_workspace_update: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        const workspace = yield* ThreadWorkspace;
        return yield* workspace
          .mutate({ ...input, threadId: projection.thread.id })
          .pipe(Effect.mapError(failure));
      }),
  ),
  review_create: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        const reviews = yield* ReviewArtifacts.ReviewArtifacts;
        const review = yield* reviews
          .create({ threadId: projection.thread.id, content: input.content })
          .pipe(Effect.mapError(failure));
        const workspace = yield* ThreadWorkspace;
        yield* workspace.importReview(review).pipe(Effect.mapError(failure));
        return { reviewId: review.id, threadId: review.threadId };
      }),
  ),
  review_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const reviews = yield* ReviewArtifacts.ReviewArtifacts;
      const review = yield* reviews.getPublished(input).pipe(Effect.mapError(failure));
      yield* readThread(review.threadId);
      return review;
    }),
  ),
});
