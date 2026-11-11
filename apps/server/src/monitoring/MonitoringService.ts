import {
  MonitoringError,
  MonitoringProfileId,
  MonitoringUpsertInput,
  ScheduledTaskId,
  type MonitoringListResult,
  type MonitoringProfile,
  type MonitoringFinding,
  type MonitoringRun,
  type MonitoringSetDispositionInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { forkParked } from "../serverActivation.ts";
import * as Stream from "effect/Stream";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as MonitoringStore from "./MonitoringStore.ts";
import * as MonitoringRunner from "./MonitoringRunner.ts";

const decodeUpsert = Schema.decodeEffect(MonitoringUpsertInput);
const isMonitoringError = Schema.is(MonitoringError);

export class MonitoringService extends Context.Service<
  MonitoringService,
  {
    readonly status: () => Effect.Effect<{ readonly unreadCount: number }, MonitoringError>;
    readonly list: () => Effect.Effect<MonitoringListResult, MonitoringError>;
    readonly upsert: (
      input: MonitoringUpsertInput,
    ) => Effect.Effect<{ profile: MonitoringProfile }, MonitoringError>;
    readonly setEnabled: (input: {
      readonly id: MonitoringProfileId;
      readonly enabled: boolean;
    }) => Effect.Effect<{ profile: MonitoringProfile }, MonitoringError>;
    readonly runNow: (input: {
      readonly id: MonitoringProfileId;
    }) => Effect.Effect<{ run: MonitoringRun }, MonitoringError>;
    readonly setDisposition: (
      input: MonitoringSetDispositionInput,
    ) => Effect.Effect<{ finding: MonitoringFinding }, MonitoringError>;
  }
>()("t3/monitoring/MonitoringService") {}
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* MonitoringStore.MonitoringStore;
  const runner = yield* MonitoringRunner.MonitoringRunner;
  const tasks = yield* ScheduledTaskService.ScheduledTaskService;
  const random = yield* SecureRandom.SecureRandom;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const scope = yield* Effect.scope;
  const turnEndReviews = new Map<
    MonitoringProfileId,
    Map<ThreadId, { until: number; inFlight: boolean }>
  >();
  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      Effect.gen(function* () {
        if (
          event.type !== "run.updated" ||
          !["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(
            event.payload.status,
          )
        )
          return;
        const run = event.payload;
        const profiles = (yield* store.listProfiles()).filter(
          (profile) => profile.enabled && profile.turnEnd,
        );
        if (!profiles.length) return;
        const rows = yield* sql<{
          project_id: string;
          origin_kind: string | null;
          origin_event: string | null;
          task_id: string | null;
          idle_checkin: number | null;
        }>`SELECT t.project_id, json_extract(m.payload_json, '$.origin.kind') AS origin_kind,
      json_extract(m.payload_json, '$.origin.event') AS origin_event,
      json_extract(m.payload_json, '$.scheduledTaskId') AS task_id,
      json_extract(s.schedule_json, '$.idleCheckin') AS idle_checkin
      FROM orchestration_v2_projection_threads t
      LEFT JOIN orchestration_v2_projection_messages m ON m.message_id=${run.userMessageId} AND m.thread_id=t.thread_id
      LEFT JOIN scheduled_tasks s ON s.task_id=json_extract(m.payload_json, '$.scheduledTaskId')
      WHERE t.thread_id=${run.threadId} AND t.archived_at IS NULL AND t.deleted_at IS NULL`.pipe(
          NodeSqliteClient.readOnly,
        );
        const target = rows[0];
        if (
          !target ||
          target.task_id?.startsWith("monitoring:") ||
          target.idle_checkin === 1 ||
          (target.origin_kind === "system" && target.origin_event?.startsWith("monitoring"))
        )
          return;
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        for (const [profileId, reviews] of turnEndReviews) {
          for (const [threadId, state] of reviews)
            if (!state.inFlight && state.until <= now) reviews.delete(threadId);
          if (!reviews.size) turnEndReviews.delete(profileId);
        }
        for (const profile of profiles) {
          if (profile.projectId !== target.project_id) continue;
          let reviews = turnEndReviews.get(profile.id);
          if (!reviews) {
            reviews = new Map();
            turnEndReviews.set(profile.id, reviews);
          }
          if (reviews.has(run.threadId)) continue;
          const state = { until: now + (profile.turnEnd?.cooldownMs ?? 600_000), inFlight: true };
          reviews.set(run.threadId, state);
          yield* runner.run(profile.id, run.threadId).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Turn-end monitoring review failed", {
                operation: cause.operation,
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                state.inFlight = false;
              }),
            ),
            Effect.forkIn(scope),
          );
        }
      }).pipe(Effect.catch(() => Effect.logWarning("Could not process monitoring turn end"))),
    ).pipe(Effect.catch(() => Effect.logWarning("Monitoring turn-end event stream failed"))),
  );

  const upsert = Effect.fn("MonitoringService.upsert")(function* (input: MonitoringUpsertInput) {
    yield* decodeUpsert(input).pipe(
      Effect.mapError((cause) => new MonitoringError({ operation: "validate profile", cause })),
    );
    yield* runner.validateModel(input.modelSelection, input.kind);
    const id =
      input.id ??
      MonitoringProfileId.make(
        yield* random
          .uuidV4()
          .pipe(
            Effect.mapError((cause) => new MonitoringError({ operation: "create profile", cause })),
          ),
      );
    const previous = yield* store.getProfile(id);
    if (input.id && !previous)
      return yield* new MonitoringError({ operation: "profile not found" });
    const now = DateTime.formatIso(yield* DateTime.now);
    const scheduledTaskId = previous?.scheduledTaskId ?? ScheduledTaskId.make(`monitoring:${id}`);
    const profile: MonitoringProfile = {
      ...input,
      enabled: input.kind === "context-review" && !previous ? false : input.enabled,
      id,
      scheduledTaskId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* store.saveProfile(profile);
          yield* tasks
            .upsert({
              id: scheduledTaskId,
              title: profile.title,
              prompt: "Read-only standards monitoring",
              enabled: profile.enabled,
              projectId: profile.projectId,
              modelSelection: profile.modelSelection,
              schedule: profile.schedule,
              threadId: null,
              threadMode: "new_thread",
              workspaceStrategy: { type: "root" },
              runtimeMode: "approval-required",
              interactionMode: "default",
              createdBy: "system",
              creationSource: "server",
            })
            .pipe(
              Effect.mapError(
                (cause) => new MonitoringError({ operation: "save schedule", cause }),
              ),
            );
          return { profile };
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isMonitoringError(cause)
            ? cause
            : new MonitoringError({ operation: "save profile and schedule", cause }),
        ),
      );
  });
  return MonitoringService.of({
    status: store.status,
    list: store.list,
    upsert,
    setEnabled: Effect.fn("MonitoringService.setEnabled")(function* (input) {
      const previous = yield* store.getProfile(input.id);
      if (!previous) return yield* new MonitoringError({ operation: "profile not found" });
      const profile = {
        ...previous,
        enabled: input.enabled,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      };
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* tasks
              .setEnabled({ id: profile.scheduledTaskId, enabled: input.enabled })
              .pipe(
                Effect.mapError(
                  (cause) => new MonitoringError({ operation: "pause schedule", cause }),
                ),
              );
            yield* store.saveProfile(profile);
            return { profile };
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            isMonitoringError(cause)
              ? cause
              : new MonitoringError({ operation: "save enabled state", cause }),
          ),
        );
    }),
    runNow: Effect.fn("MonitoringService.runNow")(function* (input) {
      const profile = yield* store.getProfile(input.id);
      if (!profile) return yield* new MonitoringError({ operation: "profile not found" });
      yield* tasks
        .runNow({ id: profile.scheduledTaskId })
        .pipe(
          Effect.mapError((cause) => new MonitoringError({ operation: "run schedule", cause })),
        );
      const run = (yield* store.list()).runs.find((run) => run.profileId === input.id);
      if (!run) return yield* new MonitoringError({ operation: "run was not recorded" });
      return { run };
    }),
    setDisposition: Effect.fn("MonitoringService.setDisposition")(function* (input) {
      const previous = yield* store.getFinding(input.id);
      if (!previous) return yield* new MonitoringError({ operation: "finding not found" });
      const finding = {
        ...previous,
        disposition: input.disposition,
        readAt: input.readAt === undefined ? previous.readAt : input.readAt,
        snoozedUntil: input.snoozedUntil === undefined ? previous.snoozedUntil : input.snoozedUntil,
        outcome: input.outcome === undefined ? previous.outcome : input.outcome,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      };
      yield* store.saveFinding(finding);
      return { finding };
    }),
  });
});
export const layer = Layer.effect(MonitoringService, make);
