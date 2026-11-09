import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as StatusSources from "./StatusSources.ts";

export const layer = HttpRouter.add(
  "POST",
  "/api/status-sources/:id/webhook",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const service = yield* StatusSources.StatusSources;
    const body = yield* request.arrayBuffer.pipe(
      Effect.map((buffer) => new Uint8Array(buffer)),
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(256 * 1024)),
    );
    const accepted = yield* service.webhook({
      id: params.id ?? "",
      headers: request.headers,
      body,
    });
    return HttpServerResponse.jsonUnsafe({ accepted }, { status: accepted ? 202 : 401 });
  }).pipe(
    Effect.orElseSucceed(() => HttpServerResponse.jsonUnsafe({ accepted: false }, { status: 400 })),
  ),
);
