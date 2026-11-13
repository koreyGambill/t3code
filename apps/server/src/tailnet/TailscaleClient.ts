import {
  readTailscalePeers,
  readTailscaleWhois,
  type TailscalePeers,
  type TailscaleWhois,
} from "@t3tools/tailscale";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";

export class TailscaleUnavailableError extends Schema.TaggedError<TailscaleUnavailableError>()(
  "TailscaleUnavailableError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Tailscale did not answer on this machine.";
  }
}

/** This machine's Tailscale client: who owns an address, and which nodes the tailnet has. */
export class TailscaleClient extends Context.Service<
  TailscaleClient,
  {
    /** Null when the address is not a peer this client knows. */
    readonly whois: (
      address: string,
    ) => Effect.Effect<TailscaleWhois | null, TailscaleUnavailableError>;
    readonly peers: Effect.Effect<TailscalePeers, TailscaleUnavailableError>;
  }
>()("t3/tailnet/TailscaleClient") {}

/** Asks the `tailscale` CLI, or the Windows host's client from WSL. */
export const layerCli = Layer.effect(
  TailscaleClient,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const provide = Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner);
    return TailscaleClient.of({
      whois: Effect.fn("TailscaleClient.whois")(
        function* (address: string) {
          return yield* readTailscaleWhois(address).pipe(provide);
        },
        Effect.catchIf(
          (error) =>
            error._tag === "TailscaleCommandExitError" &&
            error.stderrDiagnostic === "peer-not-found",
          () => Effect.succeed(null),
        ),
        Effect.mapError((cause) => new TailscaleUnavailableError({ cause })),
      ),
      peers: readTailscalePeers.pipe(
        provide,
        Effect.mapError((cause) => new TailscaleUnavailableError({ cause })),
      ),
    });
  }),
);
