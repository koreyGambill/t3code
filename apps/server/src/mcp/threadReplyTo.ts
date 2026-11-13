import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import { numberedTurnOrigins } from "@t3tools/shared/messageReactions";
import * as Effect from "effect/Effect";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { unavailable } from "./threadAccess.ts";

/** Resolves a turn-local origin number before a send crosses an environment boundary. */
export const resolveThreadReplyTo = Effect.fn("Mcp.resolveThreadReplyTo")(function* (
  threads: ThreadManagement.ThreadManagementService["Service"],
  threadId: ThreadId | undefined,
  replyTo: number | undefined,
) {
  if (replyTo === undefined) return undefined;
  const unknown = new OrchestratorMcpFailure({
    code: "invalid_request",
    message: `Unknown replyTo ${replyTo}: use a numbered <t3_origin> n from the current turn.`,
  });
  if (threadId === undefined) return yield* unknown;
  const projection = yield* threads
    .getThreadRecords(threadId, ["runs"])
    .pipe(Effect.mapError(unavailable));
  const run = ThreadManagement.latestActiveRun(projection);
  if (run === undefined) return yield* unknown;
  const ids = run.inputMessageIds ?? [run.userMessageId];
  const { messages } = yield* threads
    .getThreadRecords(threadId, ["messages"], { messageIds: ids })
    .pipe(Effect.mapError(unavailable));
  const byId = new Map(messages.map((message) => [message.id, message]));
  const match = numberedTurnOrigins(
    ids.flatMap((id) => {
      const message = byId.get(id);
      return message === undefined ? [] : [message];
    }),
  ).find(({ index }) => index === replyTo);
  if (match === undefined) return yield* unknown;
  return match.message.id;
});
