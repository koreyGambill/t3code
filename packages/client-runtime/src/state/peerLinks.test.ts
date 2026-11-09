import { expect, it, vi } from "@effect/vitest";
import { EnvironmentId, type PeerLinkSummary, WS_METHODS } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";

import { AVAILABLE_CONNECTION_STATE, PrimaryConnectionTarget } from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createPeerLinkEnvironmentAtoms } from "./peerLinks.ts";

it.effect("refreshes a starting peer until it answers without linking again", () =>
  Effect.gen(function* () {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    yield* Effect.addFinalizer(() => Effect.sync(() => vi.useRealTimers()));
    const environmentId = EnvironmentId.make("local");
    const link: PeerLinkSummary = {
      environmentId: EnvironmentId.make("peer"),
      label: "WSL",
      urls: ["http://127.0.0.1:3774"],
      access: "full-access",
      linkedAt: DateTime.makeUnsafe(0),
      expiresAt: DateTime.makeUnsafe(30 * 86_400_000),
      lastReachedAt: null,
      lastError: null,
      status: "unreachable",
    };
    let status: PeerLinkSummary["status"] = "unreachable";
    let probes = 0;
    const session = {
      client: {
        [WS_METHODS.peerLinksList]: () =>
          Effect.sync(() => {
            probes += 1;
            return { links: [{ ...link, status }] };
          }),
      },
    } as unknown as RpcSession;
    const supervisor = {
      target: new PrimaryConnectionTarget({
        environmentId,
        label: "Windows",
        httpBaseUrl: "http://127.0.0.1:3773",
        wsBaseUrl: "ws://127.0.0.1:3773",
      }),
      session: yield* SubscriptionRef.make(Option.some(session)),
      state: yield* SubscriptionRef.make({
        ...AVAILABLE_CONNECTION_STATE,
        phase: "connected" as const,
      }),
    } as EnvironmentSupervisor.EnvironmentSupervisor["Service"];
    const environmentRegistry = {
      run: (_, effect) =>
        Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      followStream: (_, stream) =>
        Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    } as EnvironmentRegistry.EnvironmentRegistry["Service"];
    const atoms = createPeerLinkEnvironmentAtoms(
      Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry)),
    );
    const registry = AtomRegistry.make();
    yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
    const atom = atoms.list({ environmentId, input: {} });
    registry.mount(atom);
    const read = AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
    expect((yield* read).links[0]?.status).toBe("unreachable");

    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(10_000));
    expect((yield* read).links[0]?.status).toBe("unreachable");
    expect(probes).toBe(2);
    status = "reachable";
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(10_000));
    expect((yield* read).links).toEqual([{ ...link, status: "reachable" }]);
    expect(probes).toBe(3);

    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(30_000));
    expect(probes).toBe(3);
  }).pipe(Effect.scoped),
);
