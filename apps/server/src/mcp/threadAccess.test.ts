import { expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";
import { readThread } from "./threadAccess.ts";

const bareId = ThreadId.make("5d0b4a3e-8c1f-4a52-9d37-2f6c7e1b9a04");
const client: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:thread-access"),
  requestNamespace: "client:thread-access",
  thread: undefined,
  client: { sessionId: "thread-access", label: "Claude Code", access: "full-access" },
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const readBare = (existing: ReadonlyArray<ThreadId>, threadId = bareId) =>
  readThread(threadId).pipe(
    Effect.flip,
    Effect.provideService(McpInvocationContext.McpInvocationContext, client),
    Effect.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) =>
          Effect.succeed(existing.includes(threadId) ? liveThreadShell(threadId) : null),
      }),
    ),
  );

it.effect("points an unprefixed id at the live thread it belongs to", () =>
  Effect.gen(function* () {
    const delegatedId = ThreadId.make(
      "delegated-task:command%3Amcp%3Aparent%3Adelegate-task%3Achild",
    );
    for (const [supplied, full] of [
      [bareId, ThreadId.make(`mcp:${bareId}`)],
      [delegatedId, ThreadId.make(`thread:${delegatedId}`)],
    ] as const) {
      const error = yield* readBare([full], supplied);

      expect(error.code).toBe("thread_not_found");
      expect(error.message).toBe(`The thread was not found. Did you mean \`${full}\`?`);

      const missing = yield* readBare([], supplied);
      expect(missing.message).toBe("The thread was not found.");
    }
  }),
);
