import {
  ThreadMarksError,
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
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

const isXwingEnvironmentId = Schema.is(XwingEnvironmentId);

export class ThreadMarks extends Context.Service<
  ThreadMarks,
  {
    readonly get: (
      input: ThreadMarksGetInput,
    ) => Effect.Effect<ReadonlyArray<ThreadMark>, ThreadMarksError>;
  }
>()("t3/threadWorkspace/ThreadMarks") {}
const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
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
    return [
      ...collectWorkspaceMarks(
        records.messages.map((message) => ({
          text: message.text,
          createdAt: DateTime.formatIso(message.createdAt),
        })),
      ),
      ...environments,
    ].toSorted((left, right) => left.timestamp.localeCompare(right.timestamp));
  });
  return ThreadMarks.of({ get });
});
export const layer = Layer.effect(ThreadMarks, make);
