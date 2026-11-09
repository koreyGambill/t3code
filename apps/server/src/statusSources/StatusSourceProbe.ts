import { StatusPayload, type StatusSourceKind, type StatusSourcesError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const STATUS_LIMIT = 256 * 1024;
const FAVICON_LIMIT = 32 * 1024;

class ResponseSizeError extends Schema.TaggedError<ResponseSizeError>()("ResponseSizeError", {}) {}

export class StatusSourceProbe extends Context.Service<
  StatusSourceProbe,
  {
    readonly check: (input: {
      readonly kind: StatusSourceKind;
      readonly target: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly timeoutSeconds: number;
      readonly name: string;
    }) => Effect.Effect<StatusPayload, StatusSourcesError>;
    readonly favicon: (target: string) => Effect.Effect<string | undefined>;
  }
>()("t3/statusSources/StatusSourceProbe") {}

function sanitizeStatusUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function statusTargetOrigin(value: string): string | undefined {
  const url = sanitizeStatusUrl(value);
  return url === undefined ? undefined : `${new URL(url).origin}/`;
}

export function normalizeStatusPayload(payload: StatusPayload): StatusPayload {
  const { url, ...rest } = payload;
  const publicUrl = url === undefined ? undefined : sanitizeStatusUrl(url);
  return {
    ...rest,
    ...(publicUrl === undefined ? {} : { url: publicUrl }),
    items: payload.items.map(({ url, ...item }) => {
      const publicUrl = url === undefined ? undefined : sanitizeStatusUrl(url);
      return { ...item, ...(publicUrl === undefined ? {} : { url: publicUrl }) };
    }),
  };
}

const decodePayload = Schema.decodeUnknownEffect(Schema.fromJsonString(StatusPayload));

const make = Effect.gen(function* () {
  const client = HttpClient.withScope(yield* HttpClient.HttpClient);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const favicons = new Map<
    string,
    { readonly value: string | undefined; readonly expiresAt: number }
  >();

  // The enclosing check/favicon span catches private stream failures before tracing them.
  const readBounded = Effect.fnUntraced(function* <E, R>(
    stream: Stream.Stream<Uint8Array, E, R>,
    limit: number,
  ) {
    const chunks: Array<Uint8Array> = [];
    let size = 0;
    yield* stream.pipe(
      Stream.runForEach((chunk) => {
        size += chunk.byteLength;
        if (size > limit) return Effect.fail(new ResponseSizeError());
        chunks.push(chunk);
        return Effect.void;
      }),
    );
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  });

  // Transport errors carry credential-bearing requests; the enclosing operation normalizes them.
  const get = Effect.fnUntraced(
    function* (target: string, headers: Readonly<Record<string, string>>) {
      return yield* client.execute(
        HttpClientRequest.get(target).pipe(HttpClientRequest.setHeaders(headers)),
      );
    },
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    // Source URLs and custom headers can contain credentials beyond standard redaction names.
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
  );

  const check = Effect.fn("StatusSourceProbe.check")(function* (
    input: Parameters<StatusSourceProbe["Service"]["check"]>[0],
  ) {
    const url = statusTargetOrigin(input.target);
    const state = (state: StatusPayload["state"], summary: string): StatusPayload => ({
      source: input.name,
      state,
      summary,
      ...(input.kind !== "command" && url !== undefined ? { url } : {}),
      items: [],
    });

    const run = Effect.gen(function* () {
      if (input.kind === "webhook") return state("unknown", "Waiting for a webhook");
      if (input.kind === "command") {
        const handle = yield* spawner.spawn(
          ChildProcess.make(input.target, [], {
            shell: true,
            forceKillAfter: "1 second",
            stdin: "ignore",
            stderr: "ignore",
          }),
        );
        const bytes = yield* readBounded(handle.stdout, STATUS_LIMIT);
        const exitCode = yield* handle.exitCode;
        const stdout = new TextDecoder().decode(bytes).trim();
        if (stdout.startsWith("{") || stdout.startsWith("[")) {
          return yield* decodePayload(stdout).pipe(
            Effect.map(normalizeStatusPayload),
            Effect.orElseSucceed(() => state("unknown", "Invalid status response")),
          );
        }
        return state(exitCode === 0 ? "ok" : "fail", `Command exited ${exitCode}`);
      }
      if (url === undefined) return state("unknown", "Invalid HTTP URL");
      const response = yield* get(input.target, input.headers);
      if (input.kind === "http-health" || response.status < 200 || response.status >= 300) {
        return state(
          response.status >= 200 && response.status < 300 ? "ok" : "fail",
          `HTTP ${response.status}`,
        );
      }
      const bytes = yield* readBounded(response.stream, STATUS_LIMIT);
      return yield* decodePayload(new TextDecoder().decode(bytes)).pipe(
        Effect.map(normalizeStatusPayload),
        Effect.orElseSucceed(() => state("unknown", "Invalid status response")),
      );
    });

    return yield* run.pipe(
      Effect.scoped,
      Effect.timeout(`${input.timeoutSeconds} seconds`),
      Effect.catchTags({
        ResponseSizeError: () =>
          Effect.succeed(state("unknown", "Response exceeded the size limit")),
      }),
      Effect.catch((error) =>
        Effect.succeed(
          state("unknown", Cause.isTimeoutError(error) ? "Check timed out" : "Check failed"),
        ),
      ),
    );
  });

  const favicon = Effect.fn("StatusSourceProbe.favicon")(function* (target: string) {
    const publicUrl = sanitizeStatusUrl(target);
    if (publicUrl === undefined) return undefined;
    const origin = new URL(publicUrl).origin;
    const now = yield* Clock.currentTimeMillis;
    const cached = favicons.get(origin);
    if (cached !== undefined && cached.expiresAt > now) return cached.value;
    const load = Effect.gen(function* () {
      const response = yield* get(`${origin}/favicon.ico`, {});
      if (response.status < 200 || response.status >= 300) return undefined;
      const mime = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
      if (mime !== "image/png" && mime !== "image/x-icon" && mime !== "image/vnd.microsoft.icon") {
        return undefined;
      }
      const bytes = yield* readBounded(response.stream, FAVICON_LIMIT);
      const isPng =
        bytes.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
      const isIco =
        bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
      if (mime === "image/png" ? !isPng : !isIco) return undefined;
      return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    });
    const value = yield* load.pipe(
      Effect.scoped,
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => undefined),
    );
    if (favicons.size >= 128 && !favicons.has(origin)) {
      const oldest = favicons.keys().next().value;
      if (oldest !== undefined) favicons.delete(oldest);
    }
    favicons.set(origin, { value, expiresAt: now + (value === undefined ? 60_000 : 600_000) });
    return value;
  });

  return StatusSourceProbe.of({ check, favicon });
});

export const layer = Layer.effect(StatusSourceProbe, make);
