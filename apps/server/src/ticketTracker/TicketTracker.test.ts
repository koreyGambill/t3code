import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProcessRunner from "../processRunner.ts";
import * as TicketTracker from "./TicketTracker.ts";
import ticket from "./fixtures/ticket.json" with { type: "json" };
import contract from "./fixtures/contract.json" with { type: "json" };

const harness = Effect.gen(function* () {
  let reads = 0;
  let output = JSON.stringify(ticket);
  let missing = false;
  const runner = Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input) => {
      if (missing)
        return Effect.fail(
          new ProcessRunner.ProcessSpawnError({
            command: input.command,
            argumentCount: input.args.length,
            cause: new Error("ENOENT"),
          }),
        );
      if (input.args[0] === "ticket" && input.args[1] === "show") reads++;
      return Effect.succeed({
        stdout:
          input.args[1] === "show" && input.args[0] === "ticket"
            ? output
            : input.args[1] === "contract"
              ? JSON.stringify(contract)
              : JSON.stringify({ ui: "https://tracker.example.com" }),
        stderr: "",
        code: ChildProcessSpawner.ExitCode(0),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      });
    },
  });
  const context = yield* Layer.build(TicketTracker.layer.pipe(Layer.provide(runner)));
  return {
    tracker: Context.get(context, TicketTracker.TicketTracker),
    reads: () => reads,
    output: (value: string) => {
      output = value;
    },
    missing: () => {
      missing = true;
    },
  };
});

it.effect("parses Bitwing state labels and workflow dispositions from CLI fixtures", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const value = yield* h.tracker.get("BW-42");
    expect(value).toMatchObject({
      key: "BW-42",
      title: "Example ticket",
      stage: "in flight",
      terminal: false,
      url: "https://tracker.example.com/tasks/BW-42",
      workflow: [
        {
          stage: "acme/app / Delivery decisions",
          done: true,
          evidence: expect.stringContaining("Focused tests passed"),
        },
        { stage: "acme/app / Independent review", done: false },
        { stage: "acme/app / Release", done: false },
        { stage: "acme/app / Independent verification", done: false },
      ],
    });
    h.output(
      JSON.stringify({
        ...ticket,
        workflow_state: "cancelled",
        workflow_metadata: { name: "cancelled", label: "cancelled", order: 60, terminal: true },
      }),
    );
    yield* TestClock.adjust("31 seconds");
    const cancelled = yield* h.tracker.get("BW-42");
    expect(cancelled?.terminal).toBe(true);
    expect(cancelled?.workflow?.find((step) => step.stage === "acme/app / Release")?.done).toBe(
      false,
    );
  }).pipe(Effect.scoped),
);

it.effect("shares per-key reads and expires after a short TTL", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* Effect.all([h.tracker.get("BW-42"), h.tracker.get("BW-42")], { concurrency: 2 });
    expect(h.reads()).toBe(1);
    yield* TestClock.adjust("31 seconds");
    yield* h.tracker.get("BW-42");
    expect(h.reads()).toBe(2);
  }).pipe(Effect.scoped),
);

it.effect("reports unavailable for absent Bitwing, invalid JSON, or mismatched keys", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    expect(yield* h.tracker.get("OTHER-42")).toBeNull();
    expect(h.reads()).toBe(0);
    for (const output of ["not json", JSON.stringify({ ...ticket, id: "BW-43" }), "{}"]) {
      h.output(output);
      yield* TestClock.adjust("31 seconds");
      expect(yield* h.tracker.get("BW-42")).toBeNull();
    }
    h.missing();
    yield* TestClock.adjust("31 seconds");
    expect(yield* h.tracker.get("BW-42")).toBeNull();
  }).pipe(Effect.scoped),
);
