import {
  EnvironmentId,
  MessageId,
  OrchestratorMcpFailure,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Statement from "effect/sql/Statement";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ThreadReplies from "./ThreadReplies.ts";

type Dispatch = Extract<OrchestrationV2Command, { type: "message.dispatch" }>;

const sender = ThreadId.make("thread:replies:sender");
const target = ThreadId.make("thread:replies:target");
const projectId = ProjectId.make("project:replies");
const request = {
  messageId: MessageId.make("message:replies:request"),
  senderThreadId: sender,
  targetThreadId: target,
};

const run = (id: string, status: OrchestrationV2Run["status"]) =>
  ({ id: RunId.make(id), status }) as OrchestrationV2Run;

interface World {
  /** What each wait on the target ends with, in order; a wait past the end never ends. */
  readonly waits: Array<{ readonly ends: OrchestrationV2Run }>;
  messageRunId: RunId;
  targetDeleted: boolean;
  answerText?: string;
  crashAfterReplyCommit?: boolean;
  peerCall?: PeerMcpClient.PeerMcpClient["Service"]["call"];
}

const threadsFor = (
  world: World,
  waited: Ref.Ref<ReadonlyArray<RunId | undefined>>,
  delivered: Deferred.Deferred<Dispatch>,
  sql: SqlClient.SqlClient,
) =>
  Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadRecords: ((
      threadId: ThreadId,
      _fields: unknown,
      filter?: { readonly messageIds?: ReadonlyArray<MessageId> },
    ) =>
      Effect.succeed({
        thread: {
          id: threadId,
          projectId,
          title: threadId === target ? "Builder" : "Lead",
          deletedAt: threadId === target && world.targetDeleted ? "deleted" : null,
          archivedAt: null,
        },
        messages:
          threadId === target
            ? [
                ...(filter?.messageIds ?? []).map((id) => ({
                  id,
                  runId: world.messageRunId,
                  role: "user",
                  text: "do it",
                })),
                {
                  id: MessageId.make("message:replies:answer"),
                  runId: RunId.make("run:replies:steered"),
                  role: "assistant",
                  text: world.answerText ?? "Done: shipped it.",
                  updatedAt: 0,
                },
              ]
            : [],
        turnItems: [],
      })) as never,
    waitForThread: (input) =>
      Ref.updateAndGet(waited, (runs) => [...runs, input.runId]).pipe(
        Effect.flatMap((runs) => {
          const next = world.waits[runs.length - 1];
          return next === undefined
            ? Effect.never
            : Effect.succeed({
                threadId: target,
                run: next.ends,
                timedOut: false,
              });
        }),
      ),
    dispatch: (command) =>
      Effect.gen(function* () {
        if (world.crashAfterReplyCommit !== undefined) {
          yield* sql`INSERT INTO test_reply_deliveries (message_id) VALUES (${(command as Dispatch).messageId}) ON CONFLICT DO NOTHING`.pipe(
            Effect.orDie,
          );
        }
        yield* Deferred.succeed(delivered, command as Dispatch);
        if (world.crashAfterReplyCommit) return yield* Effect.never;
        return { sequence: 1 } as never;
      }),
  });

const environment = Layer.mock(ServerEnvironment.ServerEnvironment)({
  getEnvironmentId: Effect.succeed(EnvironmentId.make("environment:replies")),
});

/** One server lifetime over the test's database; it ends when `use` returns. */
const serve = <A, E>(
  world: World,
  use: (
    replies: ThreadReplies.ThreadReplies["Service"],
    delivered: Deferred.Deferred<Dispatch>,
    waited: Ref.Ref<ReadonlyArray<RunId | undefined>>,
  ) => Effect.Effect<A, E, Scope.Scope | SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const delivered = yield* Deferred.make<Dispatch>();
    const waited = yield* Ref.make<ReadonlyArray<RunId | undefined>>([]);
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      ThreadReplies.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            threadsFor(world, waited, delivered, sql),
            environment,
            Layer.mock(PeerMcpClient.PeerMcpClient)(
              world.peerCall === undefined ? {} : { call: world.peerCall },
            ),
          ),
        ),
      ),
      scope,
    );
    return yield* use(Context.get(context, ThreadReplies.ThreadReplies), delivered, waited).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.ensuring(Scope.close(scope, Exit.void)),
    );
  }).pipe(Effect.provideService(ThreadReplies.ReplyRetrySchedule, Schedule.recurs(0)));

const admit = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO thread_reply_requests (message_id, sender_thread_id, target_thread_id, created_at)
    VALUES (${request.messageId}, ${sender}, ${target}, '2026-11-07T00:00:00Z')
  `;
});

describe("ThreadReplies", () => {
  it.effect.each(
    [false, true].flatMap((remote) =>
      (
        [
          { status: "completed", reply: null, answer: " \n[react 1:ack]\n " },
          { status: "failed", reply: "failed.", answer: "[react 1:ack]" },
          { status: "cancelled", reply: "was stopped.", answer: "[react 1:ack]" },
          {
            status: "completed",
            reply: "Decision needed.",
            answer: "Decision needed.",
          },
        ] as const
      ).map((outcome) => ({ remote, ...outcome })),
    ),
  )(
    "closes reaction-only requests and forwards visible replies or unsuccessful outcomes (remote=$remote, status=$status)",
    ({ remote, status, reply, answer }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const finished = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
        const observeDelivery: Statement.Transformer = (statement, _sql, fiber) =>
          statement.compile()[0].includes("UPDATE thread_reply_requests SET delivered_at")
            ? Deferred.succeed(finished, fiber).pipe(Effect.as(statement))
            : Effect.succeed(statement);
        const world: World = {
          waits: [{ ends: run("run:replies:steered", status) }],
          messageRunId: RunId.make("run:replies:steered"),
          targetDeleted: false,
          answerText: answer,
          peerCall: ((call) =>
            Effect.succeed(
              call.tool === "t3_thread_send"
                ? {
                    threadId: target,
                    messageId: request.messageId,
                    runId: world.messageRunId,
                    status: "running",
                    delivery: "started",
                  }
                : call.tool === "t3_thread_wait"
                  ? {
                      threadId: target,
                      runId: world.messageRunId,
                      status,
                      timedOut: false,
                    }
                  : {
                      thread: { title: "Remote builder" },
                      items: [
                        {
                          type: "assistant_message",
                          runId: world.messageRunId,
                          text: world.answerText,
                        },
                      ],
                      hasMore: false,
                      nextPosition: null,
                    },
            )) as PeerMcpClient.PeerMcpClient["Service"]["call"],
        };
        yield* serve(world, (replies, delivered) =>
          Effect.gen(function* () {
            if (remote) {
              yield* replies.sendRemote({
                senderThreadId: sender,
                environmentId: EnvironmentId.make("environment:remote"),
                limits: { runtimeMode: "approval-required", interactionMode: "plan" },
                input: { threadId: target, message: "do it", clientRequestId: "fwd:quiet" },
              });
            } else {
              yield* admit;
              yield* replies.followCommitted(request.messageId);
            }
            expect(Exit.isSuccess(yield* Fiber.await(yield* Deferred.await(finished)))).toBe(true);
            expect(yield* Deferred.isDone(delivered)).toBe(reply !== null);
            if (reply !== null) {
              const dispatched = yield* Deferred.await(delivered);
              expect(dispatched.text).toBe(reply);
              expect(dispatched.notification?.outcome).toBe(status);
            }
            expect(
              yield* sql`SELECT message_id FROM thread_reply_requests WHERE delivered_at IS NULL`,
            ).toHaveLength(0);
            expect(yield* replies.owes({ threadId: target, to: sender })).toBe(false);
          }),
        ).pipe(Effect.provideService(Statement.CurrentTransformer, observeDelivery));
      }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );

  it.effect("recovers a remote send accepted before its receipt and deduplicates its reply", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE test_reply_deliveries (message_id TEXT PRIMARY KEY)`;
      const sent = yield* Deferred.make<void>();
      const accepted = new Set<string>();
      const remoteEnvironment = EnvironmentId.make("environment:remote");
      const limits = { runtimeMode: "approval-required", interactionMode: "plan" } as const;
      const input = { threadId: target, message: "do it", clientRequestId: "fwd:trusted" };
      const world: World = {
        waits: [],
        messageRunId: RunId.make("run:remote"),
        targetDeleted: false,
        crashAfterReplyCommit: true,
        peerCall: ((call) =>
          Effect.gen(function* () {
            expect(call.environmentId).toBe(remoteEnvironment);
            expect(call.limits).toEqual(limits);
            if (call.tool === "t3_thread_send") {
              expect(call.arguments.reply).toBe(false);
              expect(
                yield* sql`SELECT message_id FROM thread_reply_requests WHERE delivered_at IS NULL`.pipe(
                  Effect.orDie,
                ),
              ).toHaveLength(1);
              accepted.add(String(call.arguments.clientRequestId));
              yield* Deferred.succeed(sent, undefined);
              return yield* Effect.never;
            }
            return yield* Effect.die("must recover before waiting");
          })) as PeerMcpClient.PeerMcpClient["Service"]["call"],
      };
      yield* serve(world, (replies) =>
        Effect.gen(function* () {
          const fiber = yield* replies
            .sendRemote({ senderThreadId: sender, environmentId: remoteEnvironment, limits, input })
            .pipe(Effect.forkScoped);
          yield* Effect.raceFirst(Deferred.await(sent), Fiber.join(fiber));
        }),
      );
      world.peerCall = ((call) =>
        Effect.sync(() => {
          expect(call.limits).toEqual(limits);
          if (call.tool === "t3_thread_send") {
            accepted.add(String(call.arguments.clientRequestId));
            return {
              threadId: target,
              messageId: request.messageId,
              runId: RunId.make("run:remote"),
              status: "running",
              delivery: "started",
            };
          }
          if (call.tool === "t3_thread_wait")
            return {
              threadId: target,
              runId: RunId.make("run:remote"),
              status: "completed",
              timedOut: false,
            };
          return {
            thread: { title: "Remote builder" },
            items: [
              { type: "assistant_message", runId: RunId.make("run:remote"), text: "Remote done." },
            ],
            hasMore: false,
            nextPosition: null,
          };
        })) as PeerMcpClient.PeerMcpClient["Service"]["call"];
      const reply = yield* serve(world, (replies, delivered) =>
        replies.start().pipe(Effect.andThen(Deferred.await(delivered))),
      );
      expect(reply.text).toContain("Remote done.");
      expect(reply.notification?.source).toMatchObject({
        environmentId: remoteEnvironment,
        threadId: target,
      });
      expect(reply.origin).toMatchObject({
        kind: "thread",
        event: "reply",
        environmentId: remoteEnvironment,
        threadId: target,
      });
      world.crashAfterReplyCommit = false;
      yield* serve(world, (replies, delivered) =>
        replies.start().pipe(Effect.andThen(Deferred.await(delivered))),
      );
      expect(accepted.size).toBe(1);
      expect(yield* sql`SELECT message_id FROM test_reply_deliveries`).toHaveLength(1);
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );

  it.effect("finishes a definitively refused send without retrying it after restart", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      let calls = 0;
      const world: World = {
        waits: [],
        messageRunId: RunId.make("run:remote"),
        targetDeleted: false,
        peerCall: () =>
          Effect.suspend(() => {
            calls++;
            return Effect.fail(
              new OrchestratorMcpFailure({ code: "capability_denied", message: "Link revoked" }),
            );
          }),
      };
      yield* serve(world, (replies) =>
        Effect.gen(function* () {
          const result = yield* replies
            .sendRemote({
              senderThreadId: sender,
              environmentId: EnvironmentId.make("environment:remote"),
              limits: { runtimeMode: "approval-required", interactionMode: "plan" },
              input: { threadId: target, message: "do it", clientRequestId: "fwd:revoked" },
            })
            .pipe(Effect.exit);
          expect(Exit.isFailure(result)).toBe(true);
          expect(
            yield* sql`SELECT message_id FROM thread_reply_requests WHERE delivered_at IS NULL`,
          ).toHaveLength(0);
        }),
      );
      yield* serve(world, (replies) => replies.start());
      expect(calls).toBe(1);
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );

  it.effect("replies once the run that took a moved message ends", () =>
    Effect.gen(function* () {
      const world: World = {
        waits: [],
        messageRunId: RunId.make("run:replies:queued"),
        targetDeleted: false,
      };
      world.waits.push(
        {
          // A merged queue placeholder retires while its message moves to the delivering run.
          get ends() {
            world.messageRunId = RunId.make("run:replies:steered");
            return {
              ...run("run:replies:queued", "cancelled"),
              mergedIntoRunId: world.messageRunId,
            };
          },
        },
        { ends: run("run:replies:steered", "completed") },
      );
      yield* serve(world, (replies, delivered, waited) =>
        Effect.gen(function* () {
          expect(yield* replies.owes({ threadId: target, to: sender })).toBe(false);
          expect(yield* replies.followCommitted(request.messageId)).toBe(false);
          expect(yield* Deferred.isDone(delivered)).toBe(false);
          expect(yield* Ref.get(waited)).toEqual([]);
          yield* admit;
          expect(yield* replies.followCommitted(request.messageId)).toBe(true);
          expect(yield* replies.owes({ threadId: target, to: sender })).toBe(true);
          expect(yield* replies.owes({ threadId: sender, to: target })).toBe(false);
          const reply = yield* Deferred.await(delivered);
          expect(yield* Ref.get(waited)).toEqual([
            RunId.make("run:replies:queued"),
            RunId.make("run:replies:steered"),
          ]);
          expect(reply).toMatchObject({
            threadId: sender,
            messageId: ThreadReplies.replyMessageId(request.messageId),
            commandId: `server:thread-reply:${request.messageId}`,
            notification: {
              source: { kind: "thread_reply", threadId: target },
              outcome: "completed",
              summary: "Reply from Builder",
            },
            dispatchMode: { type: "queue_after_active" },
          });
          expect(reply.text).toContain("Done: shipped it.");
          expect(reply.origin).toMatchObject({
            kind: "thread",
            event: "reply",
            environmentId: "environment:replies",
            threadId: target,
          });
          expect(reply).not.toHaveProperty("senderThreadId");
        }),
      );
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );

  it.effect("resumes an undelivered request after a restart", () =>
    Effect.gen(function* () {
      const world: World = {
        waits: [],
        messageRunId: RunId.make("run:replies:steered"),
        targetDeleted: false,
      };
      // The send commits, then the server stops before its caller starts the follower.
      yield* admit;
      yield* serve(world, () => Effect.void);
      world.waits.push({ ends: run("run:replies:steered", "failed") });
      const reply = yield* serve(world, (replies, delivered) =>
        replies.start().pipe(Effect.andThen(Deferred.await(delivered))),
      );
      expect(reply.messageId).toBe(ThreadReplies.replyMessageId(request.messageId));
      expect(reply.notification?.outcome).toBe("failed");
      expect(reply.text).toBe("Done: shipped it.");
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );

  it.effect("retries a reply committed before acknowledgement with the same message id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE test_reply_deliveries (message_id TEXT PRIMARY KEY)`;
      const world: World = {
        waits: [{ ends: run("run:replies:steered", "completed") }],
        messageRunId: RunId.make("run:replies:steered"),
        targetDeleted: false,
        crashAfterReplyCommit: true,
      };
      yield* admit;
      yield* serve(world, (replies, delivered) =>
        replies.followCommitted(request.messageId).pipe(Effect.andThen(Deferred.await(delivered))),
      );
      world.crashAfterReplyCommit = false;
      yield* serve(world, (replies, delivered) =>
        replies.start().pipe(Effect.andThen(Deferred.await(delivered))),
      );
      expect(yield* sql`SELECT message_id FROM test_reply_deliveries`).toEqual([
        { message_id: ThreadReplies.replyMessageId(request.messageId) },
      ]);
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );

  it.effect("tells the sender when the thread is deleted before it replies", () =>
    Effect.gen(function* () {
      const world: World = {
        waits: [],
        messageRunId: RunId.make("run:replies:steered"),
        targetDeleted: true,
      };
      yield* admit;
      const reply = yield* serve(world, (replies, delivered) =>
        replies.followCommitted(request.messageId).pipe(Effect.andThen(Deferred.await(delivered))),
      );
      expect(reply.notification?.outcome).toBe("failed");
      expect(reply.text).toContain("was deleted before it replied");
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );
});
