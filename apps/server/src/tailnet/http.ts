import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as TailnetConnect from "./TailnetConnect.ts";
import {
  renderEnvironmentsPage,
  renderPairingPage,
  renderRefusalPage,
  TAILNET_PAGE_HEADERS,
} from "./tailnetHtml.ts";

const html = (body: string, status = 200) =>
  HttpServerResponse.text(body, { status, headers: TAILNET_PAGE_HEADERS });

const refusalStatus = (reason: TailnetConnect.TailnetConnectRefusal) =>
  reason === "disabled"
    ? 404
    : reason === "rate_limited"
      ? 429
      : reason === "tailscale_unavailable"
        ? 503
        : 403;

/** The socket's own ends, never forwarding headers: Tailscale names the caller by its address. */
const tailnetRequest = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request): TailnetConnect.TailnetRequest => {
    const socket = (
      request.source as {
        readonly socket?: { readonly remoteAddress?: string; readonly localAddress?: string };
      }
    ).socket;
    return {
      remoteAddress: socket?.remoteAddress,
      localAddress: socket?.localAddress,
      host: request.headers.host,
    };
  },
);

const refused = (error: TailnetConnect.TailnetConnectRefusedError) =>
  Effect.succeed(html(renderRefusalPage(error.message), refusalStatus(error.reason)));

export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const service = yield* TailnetConnect.TailnetConnect;

    yield* router.add(
      "GET",
      TailnetConnect.TAILNET_PAGE_PATH,
      Effect.gen(function* () {
        const page = yield* service.listEnvironments(yield* tailnetRequest);
        return html(renderEnvironmentsPage(page));
      }).pipe(Effect.catchTags({ TailnetConnectRefusedError: refused })),
    );

    yield* router.add(
      "GET",
      TailnetConnect.TAILNET_PAIR_PATH,
      Effect.gen(function* () {
        const pairing = yield* service.issuePairing(yield* tailnetRequest);
        const now = yield* DateTime.now;
        const expiresInMinutes = Math.max(
          1,
          Math.round(Duration.toMinutes(DateTime.distance(now, pairing.expiresAt))),
        );
        return html(renderPairingPage({ pairing, expiresInMinutes }));
      }).pipe(
        Effect.catchTags({
          TailnetConnectRefusedError: refused,
          TailnetPairingIssueError: (error) =>
            Effect.logError("tailnet pairing failed", { cause: error.cause }).pipe(
              Effect.as(html(renderRefusalPage(error.message), 500)),
            ),
        }),
      ),
    );
  }),
);
