import {
  OrchestratorMcpFailure,
  type ThreadWorkspaceError,
  type ThreadWorkspace as WorkspaceDocument,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { ThreadWorkspace } from "../../../threadWorkspace/ThreadWorkspace.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, readThread } from "../../threadAccess.ts";
import { ReviewToolkit } from "./tools.ts";

const failure = (error: ThreadWorkspaceError) =>
  new OrchestratorMcpFailure({
    code: error.code === "storage" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

const listResult = ({
  threadId,
  revision,
  items,
  summaryNotes,
  childPreamble,
}: WorkspaceDocument) => ({ threadId, revision, items, summaryNotes, childPreamble });

export const layer = McpToolAccess.toLayer(ReviewToolkit, {
  list_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const workspace = yield* ThreadWorkspace;
      if (input.allThreads) {
        yield* readCaller();
        const entries = yield* workspace.listRead(input).pipe(Effect.mapError(failure));
        yield* Effect.forEach(entries, (entry) => readThread(entry.threadId));
        return entries;
      }
      const { projection } = yield* readThread(input.threadId);
      return yield* workspace
        .listRead({ ...input, threadId: projection.thread.id })
        .pipe(Effect.mapError(failure));
    }),
  ),
  list_update: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        const workspace = yield* ThreadWorkspace;
        return yield* workspace
          .update({ ...input, threadId: projection.thread.id })
          .pipe(Effect.map(listResult), Effect.mapError(failure));
      }),
  ),
  list_rewrite: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        const workspace = yield* ThreadWorkspace;
        return yield* workspace
          .rewrite({ ...input, threadId: projection.thread.id })
          .pipe(Effect.map(listResult), Effect.mapError(failure));
      }),
  ),
  artifact_write: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        const workspace = yield* ThreadWorkspace;
        const result = yield* workspace
          .artifactWrite({ ...input, threadId: projection.thread.id })
          .pipe(Effect.mapError(failure));
        const artifact = result.artifacts.at(-1)!;
        const version = artifact.versions.at(-1)!;
        return {
          threadId: result.threadId,
          revision: result.revision,
          id: artifact.id,
          title: version.title,
          format: version.format,
          version: version.version,
          createdAt: version.createdAt,
          unansweredQuestions: version.questions.filter(
            (question) => !version.answers[question.id]?.submittedAt,
          ).length,
        };
      }),
  ),
  artifact_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId);
      const workspace = yield* ThreadWorkspace;
      return yield* workspace
        .artifactRead({ ...input, threadId: projection.thread.id })
        .pipe(Effect.mapError(failure));
    }),
  ),
  artifact_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId);
      const workspace = yield* ThreadWorkspace;
      return yield* workspace
        .artifactList({ threadId: projection.thread.id })
        .pipe(Effect.mapError(failure));
    }),
  ),
});
