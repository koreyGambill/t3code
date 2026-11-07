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
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  const upsert = Effect.fn("MonitoringService.upsert")(function* (input: MonitoringUpsertInput) {
    yield* decodeUpsert(input).pipe(
      Effect.mapError((cause) => new MonitoringError({ operation: "validate profile", cause })),
    );
    yield* runner.validateModel(input.modelSelection);
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
