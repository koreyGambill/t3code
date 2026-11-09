import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import * as StatusSourceProbe from "./StatusSourceProbe.ts";

const input = {
  name: "Checks",
  kind: "wing-status",
  target: "http://127.0.0.1:4791/api/status?token=secret",
  headers: { Authorization: "Bearer secret" },
  timeoutSeconds: 10,
} as const;

const payload = {
  source: "Stormwing",
  state: "warn",
  summary: "One check needs attention",
  url: "https://user:secret@checks.test/dashboard?token=secret#private",
  updatedAt: "2026-11-09T10:00:00Z",
  items: [
    { name: "Backup", state: "fail", detail: "Failed", url: "javascript:alert(1)" },
    { name: "Build", state: "ok", url: "https://checks.test/build?token=secret" },
  ],
};

function fixture(
  options: {
    http?: HttpClient.HttpClient;
    stdout?: Stream.Stream<Uint8Array>;
    exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode>;
  } = {},
) {
  const client =
    options.http ??
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(payload))),
    );
  const spawner = ChildProcessSpawner.make(() =>
    Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(999_999_998),
        exitCode: options.exitCode ?? Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: options.stdout ?? Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    ),
  );
  return StatusSourceProbe.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
  );
}

describe("StatusSourceProbe", () => {
  it.effect("keeps credentials on the requested origin and out of HTTP trace attributes", () =>
    Effect.gen(function* () {
      const probe = yield* StatusSourceProbe.StatusSourceProbe;
      expect((yield* probe.check(input)).state).toBe("fail");
    }).pipe(
      Effect.provide(
        fixture({
          http: HttpClient.make((request) =>
            Effect.gen(function* () {
              expect(yield* Effect.serviceOption(FetchHttpClient.RequestInit)).toMatchObject({
                _tag: "Some",
                value: { redirect: "manual" },
              });
              expect((yield* HttpClient.TracerDisabledWhen)(request)).toBe(true);
              expect(request.headers.authorization).toBe("Bearer secret");
              return HttpClientResponse.fromWeb(
                request,
                new Response(null, {
                  status: 302,
                  headers: { location: "https://other.test" },
                }),
              );
            }),
          ),
        }),
      ),
    ),
  );

  it.effect("reads wing-status and removes private URL components and unsafe links", () =>
    Effect.gen(function* () {
      const probe = yield* StatusSourceProbe.StatusSourceProbe;
      const result = yield* probe.check(input);
      expect(result).toMatchObject({
        source: "Stormwing",
        state: "warn",
        summary: payload.summary,
        url: "https://checks.test/dashboard",
      });
      expect(result.items[0]?.url).toBeUndefined();
      expect(result.items[1]?.url).toBe("https://checks.test/build");
    }).pipe(Effect.provide(fixture())),
  );

  it.effect.each([200, 204, 299, 301, 401, 503])(
    "maps HTTP %s without reading its body",
    (status) =>
      Effect.gen(function* () {
        const probe = yield* StatusSourceProbe.StatusSourceProbe;
        const result = yield* probe.check({
          ...input,
          kind: "http-health",
          target: "http://127.0.0.1:4791/private-token/health?token=secret",
        });
        expect(result.state).toBe(status >= 200 && status < 300 ? "ok" : "fail");
        expect(result.summary).toBe(`HTTP ${status}`);
        expect(result.url).toBe("http://127.0.0.1:4791/");
        expect(JSON.stringify(result)).not.toContain("private-token");
      }).pipe(
        Effect.provide(
          fixture({
            http: HttpClient.make((request) =>
              Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status }))),
            ),
          }),
        ),
      ),
  );

  it.effect.each([
    { stdout: JSON.stringify(payload), code: 0, state: "warn" },
    { stdout: "", code: 0, state: "ok" },
    { stdout: "failed", code: 2, state: "fail" },
    { stdout: '{"state":"ok"}', code: 0, state: "unknown" },
  ])("normalizes command output $state with exit $code", ({ stdout, code, state }) =>
    Effect.gen(function* () {
      const probe = yield* StatusSourceProbe.StatusSourceProbe;
      const result = yield* probe.check({
        ...input,
        kind: "command",
        target: "configured command",
      });
      expect(result.state).toBe(state);
      expect(JSON.stringify(result)).not.toContain("secret");
    }).pipe(
      Effect.provide(
        fixture({
          stdout: Stream.make(new TextEncoder().encode(stdout)),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
        }),
      ),
    ),
  );

  it.effect.each(["wing-status", "http-health", "command"] as const)(
    "bounds %s execution time",
    (kind) =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const stalled = Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.never;
        });
        const testLayer = fixture({
          http: HttpClient.make(() => stalled),
          stdout: Stream.fromEffect(stalled),
        });
        const result = yield* Effect.gen(function* () {
          const probe = yield* StatusSourceProbe.StatusSourceProbe;
          const pending = yield* probe.check({ ...input, kind }).pipe(Effect.forkChild);
          yield* Deferred.await(started);
          yield* TestClock.adjust("10 seconds");
          return yield* Fiber.join(pending);
        }).pipe(Effect.provide(testLayer));
        expect(result.state).toBe("unknown");
        expect(result.summary).toBe("Check timed out");
      }),
  );

  it.effect.each(["wing-status", "command"] as const)("bounds %s response bytes", (kind) =>
    Effect.gen(function* () {
      const probe = yield* StatusSourceProbe.StatusSourceProbe;
      const result = yield* probe.check({ ...input, kind });
      expect(result.state).toBe("unknown");
      expect(result.summary).toBe("Response exceeded the size limit");
    }).pipe(
      Effect.provide(
        fixture({
          http: HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response("x".repeat(256 * 1024 + 1))),
            ),
          ),
          stdout: Stream.make(new Uint8Array(256 * 1024 + 1)),
        }),
      ),
    ),
  );

  it.effect.each([
    { ...payload, state: "healthy" },
    { ...payload, summary: "x".repeat(1001) },
    { ...payload, items: Array.from({ length: 101 }, () => ({ name: "Check", state: "ok" })) },
  ])("rejects invalid wing-status payloads", (invalid) =>
    Effect.gen(function* () {
      const probe = yield* StatusSourceProbe.StatusSourceProbe;
      expect(yield* probe.check(input)).toMatchObject({
        state: "unknown",
        summary: "Invalid status response",
      });
    }).pipe(
      Effect.provide(
        fixture({
          http: HttpClient.make((request) =>
            Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(invalid))),
          ),
        }),
      ),
    ),
  );

  it.effect.each([
    { body: new Uint8Array(32 * 1024 + 1), mime: "image/png" },
    { body: new TextEncoder().encode("<script>bad</script>"), mime: "image/png" },
    { body: new TextEncoder().encode("<svg/>"), mime: "image/svg+xml" },
  ])("omits oversized and untrusted favicon content", ({ body, mime }) =>
    Effect.gen(function* () {
      const probe = yield* StatusSourceProbe.StatusSourceProbe;
      expect(yield* probe.favicon("https://checks.test")).toBeUndefined();
    }).pipe(
      Effect.provide(
        fixture({
          http: HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(body, { headers: { "content-type": mime } }),
              ),
            ),
          ),
        }),
      ),
    ),
  );

  it.effect("rejects unsupported request protocols without calling HTTP", () =>
    Effect.gen(function* () {
      const probe = yield* StatusSourceProbe.StatusSourceProbe;
      expect((yield* probe.check({ ...input, target: "file:///etc/passwd" })).state).toBe(
        "unknown",
      );
    }).pipe(
      Effect.provide(fixture({ http: HttpClient.make(() => Effect.die("Unexpected request")) })),
    ),
  );

  it.effect("caches safe favicons and retries failures after one minute", () =>
    Effect.gen(function* () {
      let requests = 0;
      const testLayer = fixture({
        http: HttpClient.make((request) =>
          Effect.sync(() => {
            requests++;
            expect(request.url).toBe("https://checks.test/favicon.ico");
            return HttpClientResponse.fromWeb(
              request,
              requests === 1
                ? new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })
                : new Response(new Uint8Array([0, 0, 1, 0]), {
                    headers: { "content-type": "image/x-icon" },
                  }),
            );
          }),
        ),
      });
      yield* Effect.gen(function* () {
        const probe = yield* StatusSourceProbe.StatusSourceProbe;
        expect(yield* probe.favicon("https://checks.test/path?secret=hidden")).toBeUndefined();
        expect(yield* probe.favicon("https://checks.test/other")).toBeUndefined();
        expect(requests).toBe(1);
        yield* TestClock.adjust("1 minute");
        expect(yield* probe.favicon("https://checks.test")).toBe(
          "data:image/x-icon;base64,AAABAA==",
        );
        expect(yield* probe.favicon("https://checks.test")).toBe(
          "data:image/x-icon;base64,AAABAA==",
        );
        expect(requests).toBe(2);
      }).pipe(Effect.provide(testLayer));
    }),
  );
});
