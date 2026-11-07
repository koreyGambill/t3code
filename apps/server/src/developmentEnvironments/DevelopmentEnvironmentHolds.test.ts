import { assert, it } from "@effect/vitest";
import { EnvironmentId, XwingEnvironmentId, XwingOperationFailedError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerEnvironmentIdentity } from "../environment/ServerEnvironment.ts";
import * as XwingOperations from "../xwing/XwingOperations.ts";
import * as DevelopmentEnvironmentHolds from "./DevelopmentEnvironmentHolds.ts";

const ID = XwingEnvironmentId.make("c838284042dc51de");
const binding = {
  xwingEnvironmentId: ID,
  threadId: "thread-1",
  period: "cmd-1",
  title: "Work",
};

const run = <A, E>(
  effect: Effect.Effect<A, E, DevelopmentEnvironmentHolds.DevelopmentEnvironmentHolds>,
  registered: "created" | "unchanged" | "fails",
) => {
  const calls: Array<string> = [];
  const operations = Layer.mock(XwingOperations.XwingOperations)({
    registerHold: (input) =>
      registered === "fails"
        ? Effect.fail(
            new XwingOperationFailedError({
              operation: "registerHold",
              category: "failed",
              exitCode: 1,
              cause: new Error("token=hunter2"),
            }),
          )
        : Effect.sync(() => {
            calls.push(`register ${input.key}`);
            return {
              hold: {
                environmentId: ID,
                owner: input.owner,
                key: input.key,
                label: input.label,
                createdAt: "now",
                updatedAt: "now",
                environmentStatus: "active" as const,
              },
              result: registered,
            };
          }),
    releaseHold: (input) =>
      Effect.sync(() => {
        calls.push(`release ${input.key}`);
        return {
          environmentId: ID,
          owner: input.owner,
          key: input.key,
          environmentStatus: "active" as const,
          result: "released" as const,
        };
      }),
  });
  return effect.pipe(
    Effect.exit,
    Effect.map((exit) => ({ exit, calls })),
    Effect.provide(
      DevelopmentEnvironmentHolds.layer.pipe(
        Layer.provide(
          Layer.merge(
            operations,
            Layer.mock(ServerEnvironmentIdentity)({
              getEnvironmentId: Effect.succeed(EnvironmentId.make("server-1")),
            }),
          ),
        ),
      ),
    ),
  );
};

const retain = <A, E>(commit: Effect.Effect<A, E>, keepOnFailure = false) =>
  Effect.flatMap(DevelopmentEnvironmentHolds.DevelopmentEnvironmentHolds, (holds) =>
    holds.retain(binding, commit, { keepOnFailure }),
  );

const key = DevelopmentEnvironmentHolds.holdKey(binding);

it.effect.each([
  {
    case: "a new binding that commits keeps its hold",
    registered: "created",
    fails: false,
    keepOnFailure: false,
    calls: [`register ${key}`],
  },
  {
    case: "a new binding that fails releases its hold",
    registered: "created",
    fails: true,
    keepOnFailure: false,
    calls: [`register ${key}`, `release ${key}`],
  },
  {
    case: "a replayed binding that fails keeps the earlier hold",
    registered: "unchanged",
    fails: true,
    keepOnFailure: false,
    calls: [`register ${key}`],
  },
  {
    case: "a failed launch keeps its hold, since the thread may exist",
    registered: "created",
    fails: true,
    keepOnFailure: true,
    calls: [`register ${key}`],
  },
] as const)("$case", ({ registered, fails, keepOnFailure, calls: expected }) =>
  Effect.gen(function* () {
    const { exit, calls } = yield* run(
      retain(fails ? Effect.fail("rejected") : Effect.succeed("bound"), keepOnFailure),
      registered,
    );
    assert.equal(exit._tag, fails ? "Failure" : "Success");
    assert.deepEqual(calls, [...expected]);
  }),
);

it.effect("does not bind when Xwing cannot register the hold", () =>
  Effect.gen(function* () {
    let committed = false;
    const { exit } = yield* run(
      retain(
        Effect.sync(() => {
          committed = true;
        }),
      ),
      "fails",
    );
    assert.isFalse(committed);
    assert.include(JSON.stringify(exit), "hold-unavailable");
    assert.notInclude(JSON.stringify(exit), "hunter2");
  }),
);

it("keys each binding period separately and maps keys back to their thread", () => {
  const first = DevelopmentEnvironmentHolds.holdKey({
    threadId: "thread-1",
    period: "cmd-1",
  });
  const second = DevelopmentEnvironmentHolds.holdKey({
    threadId: "thread-1",
    period: "cmd-2",
  });
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9][A-Za-z0-9._:@/+=-]{0,127}$/);
  assert.equal(
    DevelopmentEnvironmentHolds.holdThread(second, ["thread-2", "thread-1"]),
    "thread-1",
  );
  assert.isNull(DevelopmentEnvironmentHolds.holdThread(second, ["thread-2"]));
});
