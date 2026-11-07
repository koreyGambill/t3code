import { ThreadId, TerminalWorkspaceChangedError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import type * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import type { TerminalLaunchGuard } from "./Manager.ts";

const isThreadNotFound = Schema.is(ProjectionStore.ProjectionStoreThreadNotFoundError);

/**
 * Refuses a client terminal launch that names a checkout its thread has left, or that would
 * restart a shell launched for such a checkout, which would clear its history or end its command.
 * Terminals keyed by something other than a thread are not bound.
 */
export const threadCheckoutGuard =
  (threads: ThreadManagement.ThreadManagementService["Service"]): TerminalLaunchGuard =>
  (input) => {
    const requested = input.worktreePath;
    if (requested === undefined && input.existingWorktreePath === undefined) return Effect.void;
    return threads.getThreadRecords(ThreadId.make(input.threadId), []).pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          "cause" in cause && isThreadNotFound(cause.cause) ? Effect.void : Effect.die(cause),
        onSuccess: ({ thread }) =>
          thread.deletedAt !== null ||
          ((requested === undefined || thread.worktreePath === requested) &&
            (input.existingWorktreePath === undefined ||
              thread.worktreePath === input.existingWorktreePath))
            ? Effect.void
            : Effect.fail(
                new TerminalWorkspaceChangedError({
                  threadId: input.threadId,
                  terminalId: input.terminalId,
                  worktreePath: thread.worktreePath,
                }),
              ),
      }),
    );
  };
