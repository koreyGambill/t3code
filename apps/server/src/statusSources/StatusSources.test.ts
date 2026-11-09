// @effect-diagnostics-next-line nodeBuiltinImport:off -- independent HMAC oracle for signed pushes
import * as NodeCrypto from "node:crypto";
import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import type { StatusPayload, StatusSource } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Probe from "./StatusSourceProbe.ts";
import * as StatusSources from "./StatusSources.ts";

const payload = (state: StatusPayload["state"]): StatusPayload => ({
  source: "Fixture",
  state,
  summary: `Fixture ${state}`,
  items: [],
});

const setup = Effect.gen(function* () {
  const calls = yield* Queue.unbounded<void>();
  const results = yield* Queue.unbounded<StatusPayload>();
  const probe = Layer.succeed(
    Probe.StatusSourceProbe,
    Probe.StatusSourceProbe.of({
      check: () => Queue.offer(calls, undefined).pipe(Effect.andThen(Queue.take(results))),
      favicon: () => Effect.undefined,
    }),
  );
  const context = yield* Layer.build(StatusSources.layer.pipe(Layer.provide(probe)));
  const service = Context.get(context, StatusSources.StatusSources);
  const updates = yield* Queue.unbounded<ReadonlyArray<StatusSource>>();
  yield* Stream.runForEach(service.subscribe(), (value) => Queue.offer(updates, value)).pipe(
    Effect.forkScoped,
  );
  yield* Queue.take(updates);
  return { service, calls, results, updates };
});

const testLayer = ServerSecretStore.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "status-sources-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, PlatformNodeCrypto.layer)),
);

it.effect(
  "keeps credentials out of config and subscriptions, retains them on edit, and removes config",
  () =>
    Effect.gen(function* () {
      const { service } = yield* setup;
      const source = yield* service.upsert({
        name: "Health",
        kind: "http-health",
        icon: "globe",
        target: "https://user:password@example.com/health?token=secret",
        headers: { Authorization: "Bearer hidden" },
      });
      expect(source.config.target).toBe("https://example.com/health");
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const persisted = yield* fs.readFileString(`${config.stateDir}/status-sources.json`);
      expect(persisted).not.toMatch(/password|secret|hidden/);
      expect(JSON.stringify(yield* service.list())).not.toMatch(/password|secret|hidden/);
      yield* service.upsert({
        id: source.config.id,
        name: "Renamed",
        kind: "http-health",
        icon: "globe",
      });
      expect((yield* service.list())[0]?.config.hasCredentials).toBe(true);
      yield* service.remove({ id: source.config.id });
      expect(yield* service.list()).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect(
  "emits changes once, preserves the last transition, and snoozes without hiding current state",
  () =>
    Effect.gen(function* () {
      const { service, results, updates, calls } = yield* setup;
      const source = yield* service.upsert({
        name: "Fixture",
        kind: "wing-status",
        icon: "activity",
        target: "http://127.0.0.1/status",
        intervalSeconds: 30,
      });
      yield* Queue.take(updates);
      yield* Queue.take(calls);
      yield* Queue.offer(results, payload("ok"));
      expect((yield* Queue.take(updates))[0]?.lastTransition).toBeNull();
      yield* TestClock.adjust("34 seconds");
      yield* Queue.take(calls);
      yield* Queue.offer(results, payload("fail"));
      const failed = (yield* Queue.take(updates))[0]!;
      expect(failed.lastTransition).toMatchObject({ from: "ok", to: "fail" });
      const transition = failed.lastTransition;
      yield* TestClock.adjust("70 seconds");
      yield* Queue.take(calls);
      yield* Queue.offer(results, { ...payload("fail"), updatedAt: "2026-01-01T00:00:00Z" });
      yield* service.snooze({ id: source.config.id, until: "2099-01-01T00:00:00Z" });
      const snoozed = (yield* Queue.take(updates))[0]!;
      expect(snoozed.latest.state).toBe("fail");
      expect(snoozed.lastTransition).toEqual(transition);
      expect(yield* Queue.size(updates)).toBe(0);
      yield* TestClock.adjust("140 seconds");
      yield* Queue.take(calls);
      yield* Queue.offer(results, payload("ok"));
      const recovered = (yield* Queue.take(updates))[0]!;
      expect(recovered.latest.state).toBe("ok");
      expect(recovered.lastTransition).toMatchObject({ from: "fail", to: "ok" });
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("enforces the minimum interval and backs off failed polls with TestClock", () =>
  Effect.gen(function* () {
    const { service, results, updates, calls } = yield* setup;
    yield* service.upsert({
      name: "Health",
      kind: "http-health",
      icon: "globe",
      target: "http://localhost/health",
      intervalSeconds: 1,
    });
    expect((yield* Queue.take(updates))[0]?.config.intervalSeconds).toBe(30);
    yield* Queue.take(calls);
    yield* Queue.offer(results, payload("unknown"));
    yield* Queue.take(updates);
    yield* TestClock.adjust("59 seconds");
    expect(yield* Queue.size(calls)).toBe(0);
    yield* TestClock.adjust("8 seconds");
    yield* Queue.take(calls);
    yield* Queue.offer(results, payload("ok"));
    yield* Queue.take(updates);
    yield* TestClock.adjust("29 seconds");
    expect(yield* Queue.size(calls)).toBe(0);
    yield* TestClock.adjust("5 seconds");
    yield* Queue.take(calls);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect(
  "verifies signed pushes, rejects stale or replayed updates, and preserves only the newest state",
  () =>
    Effect.gen(function* () {
      const { service } = yield* setup;
      const source = yield* service.upsert({ name: "Push", kind: "webhook", icon: "activity" });
      const { secret } = yield* service.rotateWebhookSecret({ id: source.config.id });
      const push = (state: StatusPayload["state"], updatedAt: string, key = secret) => {
        const body = new TextEncoder().encode(JSON.stringify({ ...payload(state), updatedAt }));
        return service.webhook({
          id: source.config.id,
          body,
          headers: {
            "x-t3-signature": `sha256=${NodeCrypto.createHmac("sha256", key).update(body).digest("hex")}`,
          },
        });
      };
      expect(yield* push("ok", "1970-01-01T00:00:00.000Z", "wrong")).toBe(false);
      expect(yield* push("ok", "1970-01-01T00:00:00.000Z")).toBe(true);
      yield* TestClock.adjust("1 second");
      expect(yield* push("fail", "1970-01-01T00:00:01.000Z")).toBe(true);
      expect(yield* push("ok", "1970-01-01T00:00:00.500Z")).toBe(false);
      expect(yield* push("ok", "1970-01-01T00:00:01.000Z")).toBe(false);
      expect((yield* service.list())[0]?.latest.state).toBe("fail");
      yield* TestClock.adjust("1 second");
      expect(yield* push("ok", "1970-01-01T00:00:02.000Z")).toBe(true);
      expect((yield* service.list())[0]?.lastTransition).toMatchObject({ from: "fail", to: "ok" });
      yield* TestClock.adjust("6 minutes");
      expect(yield* push("fail", "1970-01-01T00:00:03.000Z")).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
