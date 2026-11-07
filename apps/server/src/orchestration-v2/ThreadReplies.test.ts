import {
  EnvironmentId,
  MessageId,
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
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
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
  crashAfterReplyCommit?: boolean;
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
                  text: "Done: shipped it.",
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
        Layer.provide(Layer.mergeAll(threadsFor(world, waited, delivered, sql), environment)),
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
  it.effect("replies once the run that took a moved message ends", () =>
    Effect.gen(function* () {
      const world: World = {
        waits: [],
        messageRunId: RunId.make("run:replies:queued"),
        targetDeleted: false,
      };
      world.waits.push(
        {
          // The queued message is promoted into the running turn while the wait is open.
          get ends() {
            world.messageRunId = RunId.make("run:replies:steered");
            return run("run:replies:queued", "cancelled");
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
          expect(reply.text).toContain(`t3-thread://v2/environment:replies/${target}`);
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
      expect(reply.text).toContain("failed");
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
