import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as DevelopmentEnvironments from "../../../developmentEnvironments/DevelopmentEnvironments.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { newCommandId, readCaller, resolveProjectId, unavailable } from "../../threadAccess.ts";
import { XwingToolkit } from "./tools.ts";

// Every failure here carries only its own message, never Xwing's output.
const failure = (error: { readonly _tag: string; readonly message: string }) =>
  error._tag === "DevelopmentEnvironmentPersistenceError"
    ? unavailable()
    : new OrchestratorMcpFailure({
        code: "invalid_request",
        message: error.message,
      });

export const layer = McpToolAccess.toLayer(XwingToolkit, {
  t3_xwing_environment_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const projectId = yield* resolveProjectId(yield* readCaller(), input.projectId);
      const environments = yield* DevelopmentEnvironments.DevelopmentEnvironments;
      return yield* environments.listCheckouts({ projectId }).pipe(Effect.mapError(failure));
    }),
  ),
  t3_xwing_environment_threads: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* readCaller();
      const environments = yield* DevelopmentEnvironments.DevelopmentEnvironments;
      return yield* environments
        .listUsage({ xwingEnvironmentId: input.xwingEnvironmentId })
        .pipe(Effect.mapError(failure));
    }),
  ),
  t3_xwing_environment_select: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { caller, threads } = yield* readCaller();
        if (caller?.id === input.threadId)
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              "Your own thread is running this call; move another stopped thread, or launch a new one with `t3_thread_launch`.",
          });
        const shell = yield* threads
          .getThreadShell(input.threadId)
          .pipe(Effect.mapError(unavailable));
        if (shell === null || shell.deletedAt !== null)
          return yield* new OrchestratorMcpFailure({
            code: "thread_not_found",
            message: "The thread was not found.",
          });
        const environments = yield* DevelopmentEnvironments.DevelopmentEnvironments;
        return yield* environments
          .selectCheckout({
            threadId: input.threadId,
            commandId: yield* newCommandId(),
            expected: {
              worktreePath: shell.worktreePath,
              xwingEnvironmentId: shell.developmentEnvironment?.xwingEnvironmentId ?? null,
            },
            target: {
              type: "xwing",
              xwingEnvironmentId: input.xwingEnvironmentId,
            },
          })
          .pipe(Effect.mapError(failure));
      }),
  ),
});
