import { type TicketData } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ProcessRunner from "../processRunner.ts";

const bitwingKey = /^BW-\d+$/;
const State = Schema.Struct({
  name: Schema.String,
  label: Schema.String,
  order: Schema.Number,
  terminal: Schema.optional(Schema.Boolean),
});
const Ticket = Schema.Struct({
  id: Schema.String,
  title: Schema.NonEmptyString,
  workflow_key: Schema.String,
  workflow_version: Schema.Int.check(Schema.isGreaterThan(0)),
  workflow_state: Schema.String,
  workflow_metadata: State,
});
const Contract = Schema.Struct({
  obligations: Schema.Array(
    Schema.Struct({
      repository: Schema.String,
      stage: Schema.Struct({ key: Schema.String, title: Schema.optional(Schema.String) }),
      satisfied: Schema.Boolean,
      disposition: Schema.optional(Schema.String),
      run_id: Schema.optional(Schema.Number),
    }),
  ),
  runs: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      reason: Schema.optional(Schema.String),
      evidence: Schema.optional(
        Schema.Array(
          Schema.Struct({ kind: Schema.String, payload: Schema.optional(Schema.Unknown) }),
        ),
      ),
    }),
  ),
});
const Status = Schema.Struct({ ui: Schema.optional(Schema.String) });
const decodeTicket = Schema.decodeOption(Schema.fromJsonString(Ticket));
const decodeContract = Schema.decodeOption(Schema.fromJsonString(Contract));
const decodeStatus = Schema.decodeOption(Schema.fromJsonString(Status));

export class TicketTracker extends Context.Service<
  TicketTracker,
  {
    /** Null means the provider or ticket is unavailable; refresh bypasses the short view cache. */
    readonly get: (
      key: string,
      options?: { readonly refresh?: boolean },
    ) => Effect.Effect<TicketData | null>;
  }
>()("t3/ticketTracker/TicketTracker") {}

/** Link only a single distinct provider key; repeated mentions do not make it ambiguous. */
export function inferTicketKey(title: string, source: string): string | undefined {
  const keys = [...new Set(`${title}\n${source}`.match(/\bBW-\d+\b/g) ?? [])];
  return keys.length === 1 ? keys[0] : undefined;
}

const make = Effect.gen(function* () {
  const processes = yield* ProcessRunner.ProcessRunner;
  const run = Effect.fn("TicketTracker.bitwing")(function* (args: ReadonlyArray<string>) {
    return yield* processes
      .run({ command: "bitwing", args, timeout: "5 seconds", maxOutputBytes: 1024 * 1024 })
      .pipe(Effect.orElseSucceed(() => null));
  });
  const lookup = Effect.fn("TicketTracker.lookup")(function* (
    key: string,
  ): Effect.fn.Return<TicketData | null> {
    // ProcessRunner resolves PATH and treats a missing optional CLI as unavailable.
    const result = yield* run(["ticket", "show", "-i", key, "-o", "json"]);
    if (result === null || result.code !== 0) return null;
    const decoded = decodeTicket(result.stdout);
    if (Option.isNone(decoded) || decoded.value.id !== key) return null;
    const ticket = decoded.value;
    const definition = yield* run(["ticket", "contract", "show", "-i", key, "-o", "json"]);
    const workflow = definition?.code === 0 ? decodeContract(definition.stdout) : Option.none();
    const status = yield* run(["serve", "status", "-o", "json"]);
    const server = status === null ? Option.none() : decodeStatus(status.stdout);
    // Bitwing's default UI port is also used when its optional local server is stopped.
    const base = Option.isSome(server) ? server.value.ui : undefined;
    if (base && !URL.canParse(base)) return null;
    const url = new URL(`/tasks/${key}`, base || "http://localhost:3200");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return {
      key,
      title: ticket.title,
      stage: ticket.workflow_metadata.label,
      url: url.href,
      ...(Option.isSome(workflow)
        ? {
            workflow: workflow.value.obligations.map((obligation) => {
              const run = workflow.value.runs.find((entry) => entry.id === obligation.run_id);
              const evidence = [
                obligation.disposition,
                run?.reason,
                ...(run?.evidence ?? []).map((entry) =>
                  entry.payload === undefined
                    ? entry.kind
                    : `${entry.kind}: ${JSON.stringify(entry.payload)}`,
                ),
              ]
                .filter(Boolean)
                .join(" · ");
              return {
                stage: `${obligation.repository} / ${obligation.stage.title || obligation.stage.key}`,
                done: obligation.satisfied,
                ...(evidence ? { evidence } : {}),
              };
            }),
          }
        : {}),
    };
  });
  const cache = yield* Cache.make({ capacity: 256, timeToLive: "30 seconds", lookup });
  return TicketTracker.of({
    get: Effect.fn("TicketTracker.get")(function* (key, options) {
      if (!bitwingKey.test(key)) return null;
      if (options?.refresh) yield* Cache.invalidate(cache, key);
      return yield* Cache.get(cache, key);
    }),
  });
});

export const layer = Layer.effect(TicketTracker, make);
