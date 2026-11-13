import {
  isReactionOnlyAssistantText,
  parseAssistantReactions,
} from "@t3tools/shared/messageReactions";
import {
  CommandId,
  EnvironmentId,
  OrchestratorMcpFailure,
  OrchestratorMcpThreadSendInput,
  OrchestratorMcpThreadSendResult,
  OrchestratorMcpThreadReadResult,
  OrchestratorMcpThreadWaitResult,
  RuntimeMode,
  ProviderInteractionMode,
  MessageId,
  type OrchestrationV2Notification,
  type OrchestrationV2Run,
  ThreadId,
  isChildThread,
} from "@t3tools/contracts";
import { subagentResultForRun } from "@t3tools/provider-core/server/subagentProjection";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
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

const RemoteRequest = Schema.Struct({
  environmentId: EnvironmentId,
  limits: Schema.Struct({ runtimeMode: RuntimeMode, interactionMode: ProviderInteractionMode }),
  input: OrchestratorMcpThreadSendInput,
});
type RemoteRequest = typeof RemoteRequest.Type;
const decodeRemoteRequest = Schema.decodeEffect(Schema.fromJsonString(RemoteRequest));
const encodeRemoteRequest = Schema.encodeUnknownEffect(Schema.fromJsonString(RemoteRequest));

export interface ThreadReplyRequest {
  readonly messageId: MessageId;
  readonly senderThreadId: ThreadId;
  readonly targetThreadId: ThreadId;
  readonly remote?: RemoteRequest;
}

/** Request-derived ids keep resumed followers from delivering the same reply twice. */
export class ThreadReplies extends Context.Service<
  ThreadReplies,
  {
    readonly sendRemote: (
      request: RemoteRequest & { readonly senderThreadId: ThreadId },
    ) => Effect.Effect<OrchestratorMcpThreadSendResult, OrchestratorMcpFailure>;
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
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const retry = yield* ReplyRetrySchedule;
  const environmentId = yield* ServerEnvironment.ServerEnvironment.pipe(
    Effect.flatMap((environment) => environment.getEnvironmentId),
  );
  // Followers live as long as this service, so shutting down stops them.
  const followers = yield* Scope.Scope;
  const following = new Set<MessageId>();

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
    const records = yield* threads.getThreadRecords(
      threadId,
      ["messages", "turnItems", "providerTurns"],
      {
        messageRoles: ["assistant"],
        messageRunIds: [run.id],
        turnItemRunId: run.id,
        turnItemTypes: ["assistant_message"],
      },
    );
    const text = subagentResultForRun(records, run, { requireReport: false }).text.trim();
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
    const outcome = "run" in ended ? outcomeOf(ended.run) : "failed";
    const reply = "run" in ended ? yield* replyText(request.targetThreadId, ended.run) : "";
    const parsed = parseAssistantReactions(reply);
    const reactionOnly = isReactionOnlyAssistantText(reply);
    // Reaction-only replies close the request so recovery never wakes the sender.
    if (reactionOnly && outcome === "completed") return yield* markDelivered(request);
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
      origin: {
        kind: "thread",
        event: "reply",
        title: target.thread.title.trim() || "Untitled",
        threadId: request.targetThreadId,
        environmentId,
        ...(isChildThread(
          { environmentId, threadId: request.senderThreadId },
          undefined,
          target.thread,
        )
          ? { relationship: "child" as const }
          : {}),
      },
      text: reactionOnly || reply.length === 0 ? `${status}.` : parsed.body,
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

  const remoteCall = <S extends Schema.Decoder<unknown>>(
    remote: RemoteRequest,
    tool: string,
    args: Record<string, unknown>,
    success: S,
  ) =>
    peers.call({
      environmentId: remote.environmentId,
      limits: remote.limits,
      tool,
      arguments: args,
      success,
    });

  const sendThere = (remote: RemoteRequest) =>
    remoteCall(
      remote,
      "t3_thread_send",
      { ...remote.input, reply: false },
      OrchestratorMcpThreadSendResult,
    );

  const deliverRemote = Effect.fn("ThreadReplies.deliverRemote")(function* (
    request: ThreadReplyRequest,
    remote: RemoteRequest,
    outcome: OrchestrationV2Notification["outcome"],
    title: string,
    answer: string,
  ) {
    const parsed = parseAssistantReactions(answer);
    const reactionOnly = isReactionOnlyAssistantText(answer);
    if (reactionOnly && outcome === "completed") return yield* markDelivered(request);
    const sender = yield* threads.getThreadRecords(request.senderThreadId, []);
    if (sender.thread.deletedAt !== null || sender.thread.archivedAt !== null)
      return yield* markDelivered(request);
    yield* threads.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`server:thread-reply:${request.messageId}`),
      threadId: request.senderThreadId,
      messageId: replyMessageId(request.messageId),
      origin: {
        kind: "thread",
        event: "reply",
        title,
        threadId: request.targetThreadId,
        environmentId: remote.environmentId,
      },
      text:
        reactionOnly || answer.length === 0
          ? `${outcome === "completed" ? "finished" : outcome === "failed" ? "failed" : "was stopped"}.`
          : parsed.body,
      notification: {
        source: {
          kind: "thread_reply",
          threadId: request.targetThreadId,
          environmentId: remote.environmentId,
        },
        outcome,
        summary: `Reply from ${title}`,
      },
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "agent",
      creationSource: "server",
    });
    yield* markDelivered(request);
  });

  const followRemote = Effect.fn("ThreadReplies.followRemote")(function* (
    request: ThreadReplyRequest,
    remote: RemoteRequest,
    accepted?: OrchestratorMcpThreadSendResult,
  ) {
    const sent = accepted ?? (yield* sendThere(remote));
    let ended;
    do {
      ended = yield* remoteCall(
        remote,
        "t3_thread_wait",
        {
          threadId: request.targetThreadId,
          runId: sent.runId,
          timeoutMs: 50_000,
          untilDelegatedWorkSettled: true,
        },
        OrchestratorMcpThreadWaitResult,
      );
    } while (ended.timedOut);
    const resultRunId = ended.resultRun?.runId ?? ended.runId;
    let afterPosition: number | undefined;
    let answer = "";
    let title = "a thread";
    while (true) {
      const read = yield* remoteCall(
        remote,
        "t3_thread_read",
        {
          threadId: request.targetThreadId,
          view: "messages",
          limit: 100,
          maxCharsPerItem: REPLY_TEXT_LIMIT,
          ...(afterPosition === undefined ? {} : { afterPosition }),
        },
        OrchestratorMcpThreadReadResult,
      );
      title = read.thread.title.trim() || "a thread";
      const candidates = read.items.filter(
        (item) =>
          item.type === "assistant_message" && item.runId === resultRunId && item.text?.trim(),
      );
      const item =
        candidates.findLast((item) => !isReactionOnlyAssistantText(item.text!)) ??
        (answer.length === 0 || isReactionOnlyAssistantText(answer)
          ? candidates.at(-1)
          : undefined);
      if (item !== undefined) answer = (item.text ?? "").slice(0, REPLY_TEXT_LIMIT);
      if (!read.hasMore || read.nextPosition === null) break;
      afterPosition = read.nextPosition;
    }
    const status = ended.resultRun?.status ?? ended.status;
    yield* deliverRemote(
      request,
      remote,
      status === "completed" ? "completed" : status === "failed" ? "failed" : "cancelled",
      title,
      answer,
    );
  });

  const isFinalRemoteFailure = (error: OrchestratorMcpFailure) =>
    error.code === "capability_denied" ||
    error.code === "thread_not_found" ||
    error.code === "run_not_found" ||
    error.code === "invalid_request" ||
    error.code === "runtime_mode_escalation_denied" ||
    error.code === "interaction_mode_escalation_denied";

  const followOne = (request: ThreadReplyRequest, accepted?: OrchestratorMcpThreadSendResult) =>
    Effect.suspend(() => {
      if (following.has(request.messageId)) return Effect.void;
      following.add(request.messageId);
      return Effect.gen(function* () {
        if (request.remote === undefined) yield* follow(request);
        else {
          const remote = request.remote;
          yield* followRemote(request, remote, accepted).pipe(
            Effect.catchTags({
              OrchestratorMcpFailure: Effect.fn("ThreadReplies.remoteFailure")(function* (
                error: OrchestratorMcpFailure,
              ) {
                if (isFinalRemoteFailure(error))
                  return yield* deliverRemote(
                    request,
                    remote,
                    "failed",
                    "a thread",
                    `Unable to receive its reply: ${error.message}`,
                  );
                return yield* error;
              }),
            }),
          );
        }
      }).pipe(
        Effect.retry(retry),
        Effect.ignoreCause({ log: true }),
        Effect.ensuring(Effect.sync(() => following.delete(request.messageId))),
        Effect.forkIn(followers),
        Effect.asVoid,
      );
    });

  const followCommitted = Effect.fn("ThreadReplies.followCommitted")(function* (
    messageId: MessageId,
    accepted?: OrchestratorMcpThreadSendResult,
  ) {
    const pending = yield* sql<{
      readonly sender_thread_id: string;
      readonly target_thread_id: string;
      readonly delivered_at: string | null;
      readonly remote_request: string | null;
    }>`
        SELECT sender_thread_id, target_thread_id, delivered_at, remote_request FROM thread_reply_requests
        WHERE message_id = ${messageId}
      `.pipe(Effect.orDie);
    const recorded = pending[0];
    if (recorded === undefined) return false;
    if (recorded.delivered_at === null)
      yield* followOne(
        {
          messageId,
          senderThreadId: ThreadId.make(recorded.sender_thread_id),
          targetThreadId: ThreadId.make(recorded.target_thread_id),
          ...(recorded.remote_request === null
            ? {}
            : {
                remote: yield* decodeRemoteRequest(recorded.remote_request).pipe(Effect.orDie),
              }),
        },
        accepted,
      );
    return true;
  });

  const owes: ThreadReplies["Service"]["owes"] = (input) =>
    sql<{ readonly owed: number }>`
      SELECT 1 AS owed FROM thread_reply_requests
      WHERE target_thread_id = ${input.threadId}
        AND sender_thread_id = ${input.to}
        AND remote_request IS NULL
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
        readonly remote_request: string | null;
      }>`
        SELECT message_id, sender_thread_id, target_thread_id, remote_request FROM thread_reply_requests
        WHERE delivered_at IS NULL
      `.pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows,
            (row) =>
              Effect.gen(function* () {
                yield* followOne({
                  messageId: MessageId.make(row.message_id),
                  senderThreadId: ThreadId.make(row.sender_thread_id),
                  targetThreadId: ThreadId.make(row.target_thread_id),
                  ...(row.remote_request === null
                    ? {}
                    : {
                        remote: yield* decodeRemoteRequest(row.remote_request).pipe(Effect.orDie),
                      }),
                });
              }),
            { discard: true },
          ),
        ),
        Effect.ignoreCause({ log: true }),
      ),
    );

  const sendRemote: ThreadReplies["Service"]["sendRemote"] = Effect.fn("ThreadReplies.sendRemote")(
    function* (request) {
      if (request.input.clientRequestId === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "A remote reply requires a stable request id.",
        });
      const messageId = MessageId.make(
        `message:remote-thread-reply:${request.input.clientRequestId}`,
      );
      const encoded = yield* encodeRemoteRequest(request).pipe(Effect.orDie);
      const now = yield* DateTime.now;
      yield* sql`
      INSERT INTO thread_reply_requests (message_id, sender_thread_id, target_thread_id, created_at, remote_request)
      VALUES (${messageId}, ${request.senderThreadId}, ${request.input.threadId}, ${DateTime.formatIso(now)}, ${encoded})
      ON CONFLICT DO NOTHING
    `.pipe(Effect.orDie);
      const rows = yield* sql<{
        readonly remote_request: string;
      }>`SELECT remote_request FROM thread_reply_requests WHERE message_id = ${messageId}`.pipe(
        Effect.orDie,
      );
      const remote = yield* decodeRemoteRequest(rows[0]!.remote_request).pipe(Effect.orDie);
      const result = yield* sendThere(remote).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (isFinalRemoteFailure(error))
              yield* sql`UPDATE thread_reply_requests SET delivered_at = ${DateTime.formatIso(now)} WHERE message_id = ${messageId}`.pipe(
                Effect.orDie,
              );
            else yield* followCommitted(messageId);
            return yield* error;
          }),
        ),
      );
      yield* followCommitted(messageId, result);
      return { ...result, reply: true };
    },
  );

  return ThreadReplies.of({ sendRemote, followCommitted, owes, start });
});

export const layer = Layer.effect(ThreadReplies, make);
