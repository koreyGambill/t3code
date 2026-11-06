import { ThreadMarksError, type ThreadMark, type ThreadMarksGetInput } from "@t3tools/contracts";
import { collectWorkspaceMarks } from "@t3tools/shared/workspaceMarks";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";

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
    return collectWorkspaceMarks(
      records.messages.map((message) => ({
        text: message.text,
        createdAt: DateTime.formatIso(message.createdAt),
      })),
    );
  });
  return ThreadMarks.of({ get });
});
export const layer = Layer.effect(ThreadMarks, make);
