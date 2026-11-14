import {
  Notification,
  NotificationError,
  NotificationRateLimitedError,
  NotificationSource,
  NotificationVerification,
  type NotificationMarkAllReadResult,
  type NotificationSeverity,
  type NotificationStreamEvent,
  type NotificationUpdateInput,
  type NotificationUpdateResult,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

export const RATE_LIMIT_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;
const DEDUPE_WINDOW_MS = 24 * HOUR_MS;
const SNAPSHOT_LIMIT = 200;

export interface RaiseInput {
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body?: string | undefined;
  readonly source: NotificationSource;
  readonly threadId: ThreadId | null;
  readonly projectId: ProjectId | null;
  /** Defaults to the title. Scoped to the source, so two threads never share a key. */
  readonly dedupeKey?: string | undefined;
  readonly verification?: NotificationVerification | undefined;
}

export interface RaiseResult {
  readonly notification: Notification;
  readonly status: "delivered" | "pending_verification" | "repeat";
}

export class NotificationService extends Context.Service<
  NotificationService,
  {
    readonly raise: (
      input: RaiseInput,
    ) => Effect.Effect<RaiseResult, NotificationError | NotificationRateLimitedError>;
    readonly update: (
      input: NotificationUpdateInput,
    ) => Effect.Effect<NotificationUpdateResult, NotificationError>;
    readonly markAllRead: () => Effect.Effect<NotificationMarkAllReadResult, NotificationError>;
    readonly subscribe: () => Stream.Stream<NotificationStreamEvent, NotificationError>;
  }
>()("t3/notifications/NotificationService") {}

interface Row {
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly severity: string;
  readonly title: string;
  readonly body: string | null;
  readonly source_json: string;
  readonly thread_id: string | null;
  readonly project_id: string | null;
  readonly read_at: string | null;
  readonly dismissed_at: string | null;
  readonly snoozed_until: string | null;
  readonly verification_json: string | null;
  readonly repeat_count: number;
}

const decodeNotification = Schema.decodeUnknownEffect(Notification);
const decodeSource = Schema.decodeUnknownEffect(Schema.fromJsonString(NotificationSource));
const decodeVerification = Schema.decodeUnknownEffect(
  Schema.fromJsonString(NotificationVerification),
);
const encodeSource = Schema.encodeEffect(Schema.fromJsonString(NotificationSource));
const encodeVerification = Schema.encodeEffect(Schema.fromJsonString(NotificationVerification));

const SEVERITY_RANK: Record<NotificationSeverity, number> = { info: 0, warning: 1, critical: 2 };

const sourceKey = (source: NotificationSource) => {
  switch (source.kind) {
    case "agent":
      return `agent:${source.threadId}`;
    case "automation":
      return `task:${source.scheduledTaskId}`;
    case "review":
      return `review:${source.scheduledTaskId}:${source.findingId}`;
  }
};

const rateKey = (source: NotificationSource) =>
  source.kind === "agent" ? `thread:${source.threadId}` : `task:${source.scheduledTaskId}`;

const isDelivered = (verification: NotificationVerification | undefined) =>
  verification === undefined ||
  verification.status === "confirmed" ||
  verification.status === "unverified";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const changes = yield* PubSub.unbounded<NotificationStreamEvent>();
  const mutations = yield* Semaphore.make(1);
  // Raise times per thread or task. A restart forgets them, which only loosens the limit once.
  const raises = new Map<string, Array<number>>();
  const failed = (operation: string) => (cause: unknown) =>
    new NotificationError({ operation, cause });
  const raiseFailed = (cause: unknown) => Effect.fail(failed("raise")(cause));
  const serialized = <A, E, R>(effect: Effect.Effect<A, E, R>) => mutations.withPermits(1)(effect);

  // Runs per row inside the traced reads below.
  const toNotification = Effect.fnUntraced(function* (row: Row) {
    const source = yield* decodeSource(row.source_json);
    const verification =
      row.verification_json === null ? undefined : yield* decodeVerification(row.verification_json);
    return yield* decodeNotification({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      severity: row.severity,
      title: row.title,
      ...(row.body === null ? {} : { body: row.body }),
      source,
      threadId: row.thread_id,
      projectId: row.project_id,
      readAt: row.read_at,
      dismissedAt: row.dismissed_at,
      snoozedUntil: row.snoozed_until,
      ...(verification === undefined ? {} : { verification }),
      repeatCount: row.repeat_count,
    });
  });
  const toNotifications = (rows: ReadonlyArray<Row>) => Effect.forEach(rows, toNotification);

  const delivered = sql`(verification_json IS NULL OR json_extract(verification_json, '$.status') IN ('confirmed', 'unverified'))`;
  const unread = (now: string) =>
    sql`${delivered} AND read_at IS NULL AND dismissed_at IS NULL AND (snoozed_until IS NULL OR julianday(snoozed_until) <= julianday(${now}))`;

  const counts = Effect.fn("NotificationService.counts")(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const rows = yield* sql<{
      severity: NotificationSeverity;
      count: number;
    }>`SELECT severity, count(*) AS count FROM notifications WHERE ${unread(now)} GROUP BY severity`;
    let maxUnreadSeverity: NotificationSeverity | null = null;
    for (const row of rows) {
      if (
        maxUnreadSeverity === null ||
        SEVERITY_RANK[row.severity] > SEVERITY_RANK[maxUnreadSeverity]
      )
        maxUnreadSeverity = row.severity;
    }
    return {
      unreadCount: rows.reduce((total, row) => total + row.count, 0),
      maxUnreadSeverity,
    };
  });

  const publish = Effect.fn("NotificationService.publish")(function* (
    items: ReadonlyArray<Notification>,
  ) {
    const visible = items.filter((item) => isDelivered(item.verification));
    if (visible.length === 0) return;
    yield* PubSub.publish(changes, { type: "upsert", ...(yield* counts()), items: visible });
  });

  const reserveRaise = Effect.fn("NotificationService.reserveRaise")(function* (
    source: NotificationSource,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const key = rateKey(source);
    const recent = (raises.get(key) ?? []).filter((at) => at > now - HOUR_MS);
    if (recent.length >= RATE_LIMIT_PER_HOUR) {
      raises.set(key, recent);
      return yield* new NotificationRateLimitedError({
        limit: RATE_LIMIT_PER_HOUR,
        retryAt: DateTime.formatIso(DateTime.makeUnsafe(recent[0]! + HOUR_MS)),
      });
    }
    raises.set(key, [...recent, now]);
  });

  const raise = Effect.fn("NotificationService.raise")(
    function* (input: RaiseInput) {
      yield* reserveRaise(input.source);
      const now = yield* DateTime.now;
      const nowIso = DateTime.formatIso(now);
      const windowStart = DateTime.formatIso(
        DateTime.subtract(now, { milliseconds: DEDUPE_WINDOW_MS }),
      );
      const dedupeKey = `${sourceKey(input.source)}\n${input.dedupeKey ?? input.title}`;
      const sourceJson = yield* encodeSource(input.source).pipe(Effect.mapError(failed("encode")));
      const verificationJson =
        input.verification === undefined
          ? null
          : yield* encodeVerification(input.verification).pipe(Effect.mapError(failed("encode")));
      const existing = yield* sql<{
        id: string;
      }>`SELECT id FROM notifications WHERE dedupe_key = ${dedupeKey} AND created_at > ${windowStart} ORDER BY created_at DESC LIMIT 1`;
      const id = existing[0]?.id ?? `notification:${yield* random.uuidV4()}`;
      if (existing[0] === undefined) {
        yield* sql`INSERT INTO notifications (id, created_at, updated_at, severity, title, body, source_json, thread_id, project_id, verification_json, dedupe_key, repeat_count)
        VALUES (${id}, ${nowIso}, ${nowIso}, ${input.severity}, ${input.title}, ${input.body ?? null}, ${sourceJson}, ${input.threadId}, ${input.projectId}, ${verificationJson}, ${dedupeKey}, 0)`;
      } else {
        // A repeat keeps the user's dismiss and snooze, but asks to be read again.
        yield* sql`UPDATE notifications SET updated_at = ${nowIso}, severity = ${input.severity}, title = ${input.title},
        body = coalesce(${input.body ?? null}, body), thread_id = ${input.threadId}, project_id = ${input.projectId},
        read_at = NULL, repeat_count = repeat_count + 1 WHERE id = ${id}`;
      }
      const rows = yield* sql<Row>`SELECT * FROM notifications WHERE id = ${id}`;
      const [notification] = yield* toNotifications(rows);
      if (notification === undefined) return yield* new NotificationError({ operation: "raise" });
      yield* publish([notification]);
      return {
        notification,
        status:
          existing[0] !== undefined
            ? "repeat"
            : isDelivered(notification.verification)
              ? "delivered"
              : "pending_verification",
      } satisfies RaiseResult;
    },
    (effect) =>
      serialized(effect).pipe(
        Effect.catchTags({ SqlError: raiseFailed, SchemaError: raiseFailed }),
      ),
  );

  const update = Effect.fn("NotificationService.update")(
    function* (input: NotificationUpdateInput) {
      const now = DateTime.formatIso(yield* DateTime.now);
      const ids = sql.in(input.ids);
      const targets = sql`id IN ${ids} AND ${delivered}`;
      const action = input.action;
      switch (action.type) {
        case "read":
          yield* sql`UPDATE notifications SET read_at = coalesce(read_at, ${now}) WHERE ${targets}`;
          break;
        case "unread":
          yield* sql`UPDATE notifications SET read_at = NULL WHERE ${targets}`;
          break;
        case "dismiss":
          yield* sql`UPDATE notifications SET dismissed_at = coalesce(dismissed_at, ${now}) WHERE ${targets}`;
          break;
        case "restore":
          yield* sql`UPDATE notifications SET dismissed_at = NULL WHERE ${targets}`;
          break;
        case "snooze":
          yield* sql`UPDATE notifications SET snoozed_until = ${action.until} WHERE ${targets}`;
          break;
        case "unsnooze":
          yield* sql`UPDATE notifications SET snoozed_until = NULL WHERE ${targets}`;
          break;
      }
      const items =
        yield* sql<Row>`SELECT * FROM notifications WHERE ${targets} ORDER BY updated_at DESC, rowid DESC`.pipe(
          Effect.flatMap(toNotifications),
        );
      yield* publish(items);
      return { items };
    },
    (effect) => serialized(effect).pipe(Effect.mapError(failed("update"))),
  );

  const markAllRead = Effect.fn("NotificationService.markAllRead")(
    function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      const items =
        yield* sql<Row>`UPDATE notifications SET read_at = ${now} WHERE ${unread(now)} RETURNING *`.pipe(
          Effect.flatMap(toNotifications),
        );
      yield* publish(items);
      return { count: items.length };
    },
    (effect) => serialized(effect).pipe(Effect.mapError(failed("mark all read"))),
  );

  const snapshot = Effect.fn("NotificationService.snapshot")(function* () {
    const items =
      yield* sql<Row>`SELECT * FROM notifications WHERE ${delivered} ORDER BY updated_at DESC, rowid DESC LIMIT ${SNAPSHOT_LIMIT}`.pipe(
        Effect.flatMap(toNotifications),
      );
    return { type: "snapshot", ...(yield* counts()), items } satisfies NotificationStreamEvent;
  });

  return NotificationService.of({
    raise,
    update,
    markAllRead,
    subscribe: () =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const first = yield* snapshot().pipe(Effect.mapError(failed("read")));
          return Stream.succeed<NotificationStreamEvent>(first).pipe(
            Stream.concat(Stream.fromSubscription(subscription)),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(NotificationService, make);
