import { assert, it } from "@effect/vitest";
import { ThreadId, TerminalWorkspaceChangedError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import type * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { threadCheckoutGuard } from "./threadCheckoutGuard.ts";

const threads = {
  getThreadRecords: (threadId: ThreadId) =>
    threadId === "thread-in-b"
      ? Effect.succeed({ thread: { worktreePath: "/checkout-b", deletedAt: null } })
      : Effect.fail(
          new Orchestrator.OrchestratorProjectionError({
            threadId,
            cause: new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId }),
          }),
        ),
} as unknown as ThreadManagement.ThreadManagementService["Service"];

it.effect.each([
  ["the thread's current checkout", "thread-in-b", "/checkout-b", true],
  ["a checkout the thread left", "thread-in-b", "/checkout-a", false],
  ["the project root after the thread left it", "thread-in-b", null, false],
  ["no checkout", "thread-in-b", undefined, true],
  ["a terminal that belongs to no thread", "project-scratch", "/checkout-a", true],
  [
    "the current checkout for a shell kept from it",
    "thread-in-b",
    "/checkout-b",
    true,
    "/checkout-b",
  ],
  [
    "the current checkout for a shell kept from one it left",
    "thread-in-b",
    "/checkout-b",
    false,
    "/checkout-a",
  ],
  ["no checkout for a shell kept from one it left", "thread-in-b", undefined, false, "/checkout-a"],
] as const)("checks a launch in %s", ([, threadId, worktreePath, allowed, existingWorktreePath]) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      threadCheckoutGuard(threads)({
        threadId,
        terminalId: "default",
        worktreePath,
        ...(existingWorktreePath === undefined ? {} : { existingWorktreePath }),
      }),
    );
    if (allowed) return assert.isTrue(Exit.isSuccess(exit));
    assert.deepEqual(
      exit,
      Exit.fail(
        new TerminalWorkspaceChangedError({
          threadId,
          terminalId: "default",
          worktreePath: "/checkout-b",
        }),
      ),
    );
  }),
);
