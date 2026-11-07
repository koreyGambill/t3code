import {
  CommandId,
  MessageId,
  type OrchestrationV2Notification,
  type OrchestrationV2Run,
  ThreadId,
} from "@t3tools/contracts";
import { subagentResultForRun } from "@t3tools/provider-core/server/subagentProjection";
import { formatThreadLink } from "@t3tools/shared/threadLinks";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { forkParked } from "../serverActivation.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

/** How long one wait on the replying thread lasts before it looks again. */
const FOLLOW_WAIT_MS = 10 * 60 * 1_000;
const REPLY_TEXT_LIMIT = 8_000;
const FOLLOW_MAX_BACKOFF = Duration.minutes(5);

/** How a follower retries a failed read or delivery; tests step it by hand. */
export const ReplyRetrySchedule = Context.Reference<Schedule.Schedule<unknown>>(
  "t3/orchestration-v2/ThreadReplies/ReplyRetrySchedule",
  {
    defaultValue: () =>
      Schedule.exponential(Duration.seconds(2)).pipe(
        Schedule.modifyDelay(({ duration }) =>
          Effect.succeed(Duration.min(duration, FOLLOW_MAX_BACKOFF)),
        ),
      ),
  },
);

export interface ThreadReplyRequest {
  readonly messageId: MessageId;
  readonly senderThreadId: ThreadId;
  readonly targetThreadId: ThreadId;
}

/** Request-derived ids keep resumed followers from delivering the same reply twice. */
export class ThreadReplies extends Context.Service<
  ThreadReplies,
  {
    /** Starts following the reply request committed with its message. */
    readonly followCommitted: (messageId: MessageId) => Effect.Effect<boolean>;
    /** Whether `threadId` still owes `to` a reply; a send from it to `to` then answers, not asks. */
    readonly owes: (input: {
      readonly threadId: ThreadId;
      readonly to: ThreadId;
    }) => Effect.Effect<boolean>;
    /** Follows every undelivered request, including those from before a restart. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/orchestration-v2/ThreadReplies") {}

export const replyMessageId = (requestMessageId: MessageId) =>
  MessageId.make(`message:thread-reply:${requestMessageId}`);

const outcomeOf = (run: OrchestrationV2Run): OrchestrationV2Notification["outcome"] =>
  run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "cancelled";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const retry = yield* ReplyRetrySchedule;
  const environmentId = yield* ServerEnvironment.ServerEnvironment.pipe(
    Effect.flatMap((environment) => environment.getEnvironmentId),
  );
  // Followers live as long as this service, so shutting down stops them.
  const followers = yield* Scope.Scope;
  const following = new Set<MessageId>();

  const linkTo = (threadId: ThreadId) => formatThreadLink({ environmentId, threadId });

  /** The run that took the request, or why there is none to wait for. */
  const locate = Effect.fn("ThreadReplies.locate")(function* (request: ThreadReplyRequest) {
    const target = yield* threads.getThreadRecords(request.targetThreadId, ["messages"], {
      messageIds: [request.messageId],
    });
    if (target.thread.deletedAt !== null) return { gone: "was deleted before it replied" } as const;
    const message = target.messages.find((candidate) => candidate.id === request.messageId);
    if (message === undefined) return { gone: "never received the message" } as const;
    return {
      projectId: target.thread.projectId,
      runId: message.runId,
    } as const;
  });

  const replyText = Effect.fn("ThreadReplies.replyText")(function* (
    threadId: ThreadId,
    run: OrchestrationV2Run,
  ) {
    const records = yield* threads.getThreadRecords(threadId, ["messages", "turnItems"], {
      messageRoles: ["assistant"],
      messageRunIds: [run.id],
      turnItemRunId: run.id,
      turnItemTypes: ["assistant_message"],
    });
    const text = subagentResultForRun(records, run).text.trim();
    return text.length <= REPLY_TEXT_LIMIT
      ? text
      : `${text.slice(0, REPLY_TEXT_LIMIT)}\n\n[Cut off. Read the rest with t3_thread_read.]`;
  });

  const markDelivered = (request: ThreadReplyRequest) =>
    DateTime.now.pipe(
      Effect.flatMap(
        (now) => sql`
          UPDATE thread_reply_requests SET delivered_at = ${DateTime.formatIso(now)}
          WHERE message_id = ${request.messageId}
        `,
      ),
    );

  const deliver = Effect.fn("ThreadReplies.deliver")(function* (
    request: ThreadReplyRequest,
    ended: { readonly run: OrchestrationV2Run } | { readonly gone: string },
  ) {
    const sender = yield* threads.getThreadRecords(request.senderThreadId, []);
    // Nobody is left to tell.
    if (sender.thread.deletedAt !== null || sender.thread.archivedAt !== null) {
      return yield* markDelivered(request);
    }
    const target = yield* threads.getThreadRecords(request.targetThreadId, []);
    const link = linkTo(request.targetThreadId);
    const outcome = "run" in ended ? outcomeOf(ended.run) : "failed";
    const reply = "run" in ended ? yield* replyText(request.targetThreadId, ended.run) : "";
    const status =
      "gone" in ended
        ? ended.gone
        : outcome === "completed"
          ? "finished"
          : outcome === "failed"
            ? "failed"
            : "was stopped";
    yield* threads.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`server:thread-reply:${request.messageId}`),
      threadId: request.senderThreadId,
      messageId: replyMessageId(request.messageId),
      text: `Thread ${link} ${status}. This is its reply to the message you sent it.${
        reply.length === 0 ? "" : `\n\n${reply}`
      }`,
      notification: {
        source: { kind: "thread_reply", threadId: request.targetThreadId },
        outcome,
        summary: `Reply from ${target.thread.title.trim() || "a thread"}`,
      },
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "agent",
      creationSource: "server",
    });
    yield* markDelivered(request);
  });

  /** Waits out the request's run and the work it awaits, then delivers its outcome. */
  const follow = Effect.fn("ThreadReplies.follow")(function* (request: ThreadReplyRequest) {
    while (true) {
      const located = yield* locate(request);
      if (located.gone !== undefined) return yield* deliver(request, { gone: located.gone });
      const waited = yield* threads
        .waitForThread({
          projectId: located.projectId,
          threadId: request.targetThreadId,
          ...(located.runId === null ? {} : { runId: located.runId }),
          timeoutMs: FOLLOW_WAIT_MS,
          untilDelegatedWorkSettled: true,
        })
        .pipe(
          Effect.catchTags({
            ThreadManagementThreadNotFoundError: () =>
              Effect.succeed({ gone: "was deleted before it replied" } as const),
          }),
        );
      if ("gone" in waited) return yield* deliver(request, waited);
      if (waited.timedOut) continue;
      // A queued message promoted to a steer moves to the running turn.
      const after = yield* locate(request);
      if (after.gone === undefined && after.runId !== located.runId) continue;
      const run = waited.resultRun ?? waited.run;
      if (run === null) return yield* deliver(request, { gone: "has no run to reply from" });
      return yield* deliver(request, { run });
    }
  });

  const followOne = (request: ThreadReplyRequest) =>
    Effect.suspend(() => {
      if (following.has(request.messageId)) return Effect.void;
      following.add(request.messageId);
      return follow(request).pipe(
        Effect.retry(retry),
        Effect.ignoreCause({ log: true }),
        Effect.ensuring(Effect.sync(() => following.delete(request.messageId))),
        Effect.forkIn(followers),
        Effect.asVoid,
      );
    });

  const followCommitted: ThreadReplies["Service"]["followCommitted"] = Effect.fn(
    "ThreadReplies.followCommitted",
  )(function* (messageId) {
    const pending = yield* sql<{
      readonly sender_thread_id: string;
      readonly target_thread_id: string;
      readonly delivered_at: string | null;
    }>`
        SELECT sender_thread_id, target_thread_id, delivered_at FROM thread_reply_requests
        WHERE message_id = ${messageId}
      `.pipe(Effect.orDie);
    const recorded = pending[0];
    if (recorded === undefined) return false;
    if (recorded.delivered_at === null)
      yield* followOne({
        messageId,
        senderThreadId: ThreadId.make(recorded.sender_thread_id),
        targetThreadId: ThreadId.make(recorded.target_thread_id),
      });
    return true;
  });

  const owes: ThreadReplies["Service"]["owes"] = (input) =>
    sql<{ readonly owed: number }>`
      SELECT 1 AS owed FROM thread_reply_requests
      WHERE target_thread_id = ${input.threadId}
        AND sender_thread_id = ${input.to}
        AND delivered_at IS NULL
      LIMIT 1
    `.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.orDie,
    );

  const start: ThreadReplies["Service"]["start"] = () =>
    forkParked(
      sql<{
        readonly message_id: string;
        readonly sender_thread_id: string;
        readonly target_thread_id: string;
      }>`
        SELECT message_id, sender_thread_id, target_thread_id FROM thread_reply_requests
        WHERE delivered_at IS NULL
      `.pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows,
            (row) =>
              followOne({
                messageId: MessageId.make(row.message_id),
                senderThreadId: ThreadId.make(row.sender_thread_id),
                targetThreadId: ThreadId.make(row.target_thread_id),
              }),
            { discard: true },
          ),
        ),
        Effect.ignoreCause({ log: true }),
      ),
    );

  return ThreadReplies.of({ followCommitted, owes, start });
});

export const layer = Layer.effect(ThreadReplies, make);
