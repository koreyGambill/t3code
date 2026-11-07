import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProviderSessionManagerV2 } from "./ProviderSessionManager.ts";

/**
 * Whether a live provider session still runs background work for a thread, such as subagents or
 * background commands. Probes even with an empty roster: Claude's native subagents never reach
 * pendingBackgroundTasks. Sessions shared across threads probe per thread.
 */
export const providerSessionHasBackgroundWork = Effect.fn("providerSessionHasBackgroundWork")(
  function* (
    providerSessions: ProviderSessionManagerV2["Service"],
    session: OrchestrationV2ThreadProjection["providerSessions"][number],
    providerThreads: OrchestrationV2ThreadProjection["providerThreads"],
  ) {
    const live = yield* providerSessions
      .get(session.id)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(live)) return false;
    const runtime = live.value;
    const probes =
      !session.capabilities.sessions.supportsMultipleProviderThreadsPerSession &&
      runtime.hasPendingBackgroundWork !== undefined
        ? [runtime.hasPendingBackgroundWork]
        : providerThreads.flatMap((providerThread) =>
            providerThread.providerSessionId === session.id &&
            runtime.hasPendingBackgroundWorkForThread !== undefined
              ? [runtime.hasPendingBackgroundWorkForThread(providerThread)]
              : [],
          );
    for (const probe of probes) {
      // A failed probe cannot confirm that the work ended.
      if (yield* probe.pipe(Effect.catchCause(() => Effect.succeed(true)))) return true;
    }
    return false;
  },
);
