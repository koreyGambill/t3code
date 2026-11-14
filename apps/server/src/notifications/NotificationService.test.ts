import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  ScheduledTaskId,
  ThreadId,
  type NotificationSource,
  type NotificationStreamEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Service from "./NotificationService.ts";

const testLayer = Service.layer.pipe(
  Layer.provideMerge(Layer.merge(Sqlite.layerMemory, NodeCrypto.layer)),
);
const agent = (thread: string): NotificationSource => ({
  kind: "agent",
  threadId: ThreadId.make(thread),
});
const raiseInput = (source: NotificationSource, title: string) => ({
  severity: "warning" as const,
  title,
  source,
  threadId: source.kind === "agent" ? source.threadId : null,
  projectId: null,
});

const subscribe = Effect.gen(function* () {
  const service = yield* Service.NotificationService;
  const events = yield* Queue.unbounded<NotificationStreamEvent>();
  yield* Stream.runForEach(service.subscribe(), (event) => Queue.offer(events, event)).pipe(
    Effect.forkScoped,
  );
  return events;
});

it.effect(
  "walks every reverse state, dedupes repeats and keeps pending ones out of the inbox",
  () =>
    Effect.gen(function* () {
      const service = yield* Service.NotificationService;
      const events = yield* subscribe;
      assert.deepStrictEqual(yield* Queue.take(events), {
        type: "snapshot",
        unreadCount: 0,
        maxUnreadSeverity: null,
        items: [],
      });

      const first = yield* service.raise({
        ...raiseInput(agent("t1"), "Lands ran from bash"),
        body: "one",
      });
      assert.strictEqual(first.status, "delivered");
      const id = first.notification.id;
      assert.deepInclude(yield* Queue.take(events), {
        type: "upsert",
        unreadCount: 1,
        maxUnreadSeverity: "warning",
      });

      const update = (action: Parameters<typeof service.update>[0]["action"]) =>
        service.update({ ids: [id], action }).pipe(Effect.map(({ items }) => items[0]!));
      assert.isNotNull((yield* update({ type: "read" })).readAt);
      assert.strictEqual((yield* Queue.take(events)).unreadCount, 0);
      assert.isNull((yield* update({ type: "unread" })).readAt);
      assert.strictEqual((yield* Queue.take(events)).unreadCount, 1);
      assert.isNotNull((yield* update({ type: "dismiss" })).dismissedAt);
      assert.strictEqual((yield* Queue.take(events)).unreadCount, 0);

      // A repeat while dismissed bumps the count and asks to be read, but leaves the dismissal.
      yield* update({ type: "read" });
      yield* Queue.take(events);
      const repeat = yield* service.raise({
        ...raiseInput(agent("t1"), "Lands ran from bash"),
        body: "two",
      });
      assert.strictEqual(repeat.status, "repeat");
      assert.strictEqual(repeat.notification.id, id);
      assert.strictEqual(repeat.notification.repeatCount, 1);
      assert.strictEqual(repeat.notification.body, "two");
      assert.isNull(repeat.notification.readAt);
      assert.isNotNull(repeat.notification.dismissedAt);
      yield* Queue.take(events);
      assert.isNull((yield* update({ type: "restore" })).dismissedAt);
      assert.strictEqual((yield* Queue.take(events)).unreadCount, 1);

      // Snooze expiry is a read-time filter: the next read after `until` counts it again.
      const until = DateTime.formatIso(DateTime.add(yield* DateTime.now, { hours: 1 }));
      assert.strictEqual((yield* update({ type: "snooze", until })).snoozedUntil, until);
      assert.strictEqual((yield* Queue.take(events)).unreadCount, 0);
      assert.deepStrictEqual(yield* service.markAllRead(), { count: 0 });
      yield* TestClock.adjust("1 hour");
      assert.strictEqual((yield* Queue.take(yield* subscribe)).unreadCount, 1);
      yield* update({
        type: "snooze",
        until: DateTime.formatIso(DateTime.add(yield* DateTime.now, { hours: 1 })),
      });
      yield* Queue.take(events);
      assert.isNull((yield* update({ type: "unsnooze" })).snoozedUntil);
      assert.strictEqual((yield* Queue.take(events)).unreadCount, 1);
      assert.deepStrictEqual(yield* service.markAllRead(), { count: 1 });
      assert.strictEqual((yield* Queue.take(events)).unreadCount, 0);

      // Another thread's identical title is its own notification.
      const other = yield* service.raise({
        ...raiseInput(agent("t2"), "Lands ran from bash"),
        severity: "critical",
      });
      assert.notStrictEqual(other.notification.id, id);
      assert.deepInclude(yield* Queue.take(events), {
        unreadCount: 1,
        maxUnreadSeverity: "critical",
      });

      const pending = yield* service.raise({
        ...raiseInput(
          { kind: "automation", scheduledTaskId: ScheduledTaskId.make("task"), runId: "run" },
          "Exposure",
        ),
        verification: { status: "pending" },
      });
      assert.strictEqual(pending.status, "pending_verification");
      yield* service.update({ ids: [pending.notification.id], action: { type: "read" } });
      const snapshot = yield* Queue.take(yield* subscribe);
      assert.deepStrictEqual(
        snapshot.items.map((item) => item.id),
        [other.notification.id, id],
      );
      assert.strictEqual(snapshot.unreadCount, 1);
      assert.strictEqual(yield* Queue.size(events), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("limits each thread or automation to ten raises an hour and dedupes within a day", () =>
  Effect.gen(function* () {
    const service = yield* Service.NotificationService;
    const task: NotificationSource = {
      kind: "automation",
      scheduledTaskId: ScheduledTaskId.make("task"),
      runId: "run-1",
    };
    for (let index = 0; index < Service.RATE_LIMIT_PER_HOUR; index++) {
      yield* service.raise(raiseInput(agent("noisy"), `finding ${index}`));
      yield* service.raise(raiseInput({ ...task, runId: `run-${index}` }, "same finding"));
    }
    const refused = yield* Effect.flip(service.raise(raiseInput(agent("noisy"), "one more")));
    assert.strictEqual(refused._tag, "NotificationRateLimitedError");
    assert.include(refused.message, "1970-01-01T01:00:00.000Z");
    assert.strictEqual(
      (yield* Effect.flip(service.raise(raiseInput({ ...task, runId: "other" }, "x"))))._tag,
      "NotificationRateLimitedError",
    );
    assert.strictEqual(
      (yield* service.raise(raiseInput(agent("quiet"), "fine"))).status,
      "delivered",
    );

    yield* TestClock.adjust("1 hour");
    assert.strictEqual(
      (yield* service.raise(raiseInput(agent("noisy"), "one more"))).status,
      "delivered",
    );
    // Every run of a task dedupes into one notification for a day, then starts a new one.
    const repeat = yield* service.raise(raiseInput({ ...task, runId: "later" }, "same finding"));
    assert.strictEqual(repeat.status, "repeat");
    assert.strictEqual(repeat.notification.repeatCount, Service.RATE_LIMIT_PER_HOUR);
    yield* TestClock.adjust("23 hours");
    assert.strictEqual(
      (yield* service.raise(raiseInput({ ...task, runId: "next-day" }, "same finding"))).status,
      "delivered",
    );
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
