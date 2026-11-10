// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as ServerConfig from "../config.ts";
import {
  ThreadMarksError,
  ThreadMarkAnnotation,
  type ThreadMarksAnnotateInput,
  XwingEnvironmentId,
  type ThreadMark,
  type ThreadMarksGetInput,
} from "@t3tools/contracts";
import { collectWorkspaceMarks } from "@t3tools/shared/workspaceMarks";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

const isXwingEnvironmentId = Schema.is(XwingEnvironmentId);

const decodeAnnotations = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(ThreadMarkAnnotation)),
);
const encodeAnnotations = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Array(ThreadMarkAnnotation)),
);
const decodeLegacyAnnotations = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      workspace: Schema.optional(
        Schema.Struct({ markAnnotations: Schema.optional(Schema.Array(ThreadMarkAnnotation)) }),
      ),
    }),
  ),
);
const annotationPath = (root: string, id: string, path: Path.Path) =>
  path.join(
    root,
    "thread-marks",
    `${NodeCrypto.createHash("sha256").update(id).digest("hex")}.json`,
  );
const annotationLock = Semaphore.makeUnsafe(1);
export const readAnnotations = Effect.fn("ThreadMarks.readAnnotations")(function* (
  threadId: string,
  legacy?: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const contents = yield* fs.readFileString(annotationPath(config.stateDir, threadId, path)).pipe(
    Effect.catchIf(
      (e) => e.reason._tag === "NotFound",
      () => Effect.succeed(null),
    ),
  );
  if (contents !== null) return yield* decodeAnnotations(contents);
  const old =
    legacy ??
    (yield* fs
      .readFileString(
        path.join(
          config.stateDir,
          "thread-workspaces",
          `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`,
        ),
      )
      .pipe(
        Effect.catchIf(
          (e) => e.reason._tag === "NotFound",
          () => Effect.succeed("{}"),
        ),
      ));
  const envelope = yield* decodeLegacyAnnotations(old);
  return envelope.workspace?.markAnnotations ?? [];
});
const writeAnnotations = Effect.fn("ThreadMarks.writeAnnotations")(function* (
  threadId: string,
  annotations: ReadonlyArray<ThreadMarkAnnotation>,
) {
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const contents = yield* encodeAnnotations(annotations);
  yield* writeFileStringAtomically({
    filePath: annotationPath(config.stateDir, threadId, path),
    contents,
  });
});

export const migrateAnnotations = Effect.fn("ThreadMarks.migrateAnnotations")(function* (
  threadId: string,
  legacy: string,
) {
  yield* writeAnnotations(threadId, yield* readAnnotations(threadId, legacy));
}, annotationLock.withPermit);

export class ThreadMarks extends Context.Service<
  ThreadMarks,
  {
    readonly annotate: (
      input: ThreadMarksAnnotateInput,
    ) => Effect.Effect<ReadonlyArray<ThreadMark>, ThreadMarksError>;
    readonly get: (
      input: ThreadMarksGetInput,
    ) => Effect.Effect<ReadonlyArray<ThreadMark>, ThreadMarksError>;
  }
>()("t3/threadWorkspace/ThreadMarks") {}
const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const services = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig
  >();
  const get = Effect.fn("ThreadMarks.get")(function* ({ threadId }: ThreadMarksGetInput) {
    const records = yield* orchestrator
      .getThreadRecords(threadId, ["messages"])
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadMarksError({ message: "Could not load this thread's links.", cause }),
        ),
      );
    if (records.thread.deletedAt !== null)
      return yield* new ThreadMarksError({ message: "This thread was deleted." });
    const usage = yield* projections
      .listDevelopmentEnvironmentUsage({ threadId })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadMarksError({ message: "Could not load this thread's environments.", cause }),
        ),
      );
    const environments = usage.flatMap((row): ReadonlyArray<ThreadMark> => {
      if (!isXwingEnvironmentId(row.xwingEnvironmentId)) return [];
      const label = row.number === null ? row.name : `#${row.number} ${row.name}`;
      return [
        {
          url: `xwing-environment:${row.xwingEnvironmentId}`,
          service: "Xwing",
          timestamp: row.firstSelectedAt,
          description: row.current ? `${label}, current checkout` : label,
          link: { type: "xwing_environment", xwingEnvironmentId: row.xwingEnvironmentId },
        },
      ];
    });
    const annotations = yield* readAnnotations(threadId).pipe(
      Effect.provide(services),
      Effect.mapError(
        (cause) => new ThreadMarksError({ message: "Could not read mark annotations.", cause }),
      ),
    );
    const derived = [
      ...collectWorkspaceMarks(
        records.messages.map((message) => ({
          text: message.text,
          createdAt: DateTime.formatIso(message.createdAt),
        })),
      ),
      ...environments,
    ];
    const marks = derived.map((mark) => ({
      ...mark,
      ...annotations.find((annotation) => annotation.url === mark.url),
    }));
    for (const annotation of annotations)
      if (!marks.some((mark) => mark.url === annotation.url))
        marks.push({
          ...annotation,
          service: "Mark",
          timestamp: DateTime.formatIso(records.thread.createdAt),
        });
    return marks.toSorted((left, right) => left.timestamp.localeCompare(right.timestamp));
  });
  return ThreadMarks.of({
    get,
    annotate: Effect.fn("ThreadMarks.annotate")(function* ({ threadId, annotation }) {
      yield* get({ threadId });
      if (annotation.contextSource) {
        const source = yield* orchestrator
          .getThreadRecords(annotation.contextSource.threadId, ["runs"])
          .pipe(
            Effect.mapError(
              (cause) =>
                new ThreadMarksError({ message: "Context mark source unavailable.", cause }),
            ),
          );
        const run = source.runs.find((run) => run.id === annotation.contextSource?.runId);
        if (
          source.thread.deletedAt !== null ||
          !run ||
          !["completed", "interrupted", "failed", "cancelled"].includes(run.status)
        )
          return yield* new ThreadMarksError({ message: "A context mark needs a finished run." });
      }
      const existing = yield* readAnnotations(threadId).pipe(
        Effect.provide(services),
        Effect.mapError(
          (cause) => new ThreadMarksError({ message: "Could not read marks.", cause }),
        ),
      );
      if (
        annotation.name &&
        existing.some((mark) => mark.url !== annotation.url && mark.name === annotation.name)
      )
        return yield* new ThreadMarksError({ message: "Mark names must be unique." });
      yield* writeAnnotations(threadId, [
        ...existing.filter((mark) => mark.url !== annotation.url),
        annotation,
      ]).pipe(
        Effect.provide(services),
        Effect.mapError(
          (cause) => new ThreadMarksError({ message: "Could not save marks.", cause }),
        ),
      );
      return yield* get({ threadId });
    }, annotationLock.withPermit),
  });
});
export const layer = Layer.effect(ThreadMarks, make);

export const layerTest = Layer.mock(ThreadMarks)({ get: () => Effect.succeed([]) });
