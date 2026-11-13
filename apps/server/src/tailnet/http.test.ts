import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ServerHttp from "../http.ts";
import * as TailnetHttp from "./http.ts";
import * as TailnetConnect from "./TailnetConnect.ts";

const ORIGIN = "http://100.64.0.1:3774";
const caller = { login: "me@example.com", nodeName: "phone", address: "100.64.0.9" };

// A form submission from the page's own confirm step; anything else must not mint.
const SAME_ORIGIN_FORM = {
  origin: ORIGIN,
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "navigate",
};
const OTHER_SITE_FETCH = {
  origin: "https://evil.example",
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "cors",
};

const send = async (
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ readonly status: number; readonly cors: string | null; readonly mints: number }> => {
  let mints = 0;
  const layerService = Layer.mock(TailnetConnect.TailnetConnect)({
    describePairing: () => Effect.succeed({ caller, environmentLabel: "Desk" }),
    listEnvironments: () => Effect.succeed({ caller, environments: [] }),
    issuePairing: () =>
      Effect.sync(() => {
        mints += 1;
        const pairingUrl = `${ORIGIN}/pair#token=SECRET`;
        return {
          caller,
          environmentLabel: "Desk",
          pairingUrl,
          appLink: `t3code://pair?pairingUrl=${encodeURIComponent(pairingUrl)}`,
          expiresAt: DateTime.makeUnsafe(0),
        };
      }),
  });
  // The packaged CORS layer: no dev URL, so every other route answers any origin.
  const layerApp = Layer.merge(TailnetHttp.layer, ServerHttp.layerBrowserApiCors).pipe(
    Layer.provide(layerService),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-tailnet-http-test-" })),
    Layer.provide(NodeServices.layer),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(layerApp, { disableLogger: true });
  try {
    const response = await handler(
      new Request(`${ORIGIN}${path}`, { method, headers: { host: "100.64.0.1:3774", ...headers } }),
    );
    await response.text();
    return {
      status: response.status,
      cors: response.headers.get("access-control-allow-origin"),
      mints,
    };
  } finally {
    await dispose();
  }
};

it("never lets another site read a pairing link or the tailnet pages", async () => {
  const cases: ReadonlyArray<
    readonly [string, string, Record<string, string>, { status: number; mints: number }]
  > = [
    // Any page a tailnet device opens would otherwise mint as that device and read the token.
    ["GET", "/tailnet/pair", OTHER_SITE_FETCH, { status: 403, mints: 0 }],
    ["POST", "/tailnet/pair", OTHER_SITE_FETCH, { status: 403, mints: 0 }],
    ["POST", "/tailnet/pair", { origin: "https://evil.example" }, { status: 403, mints: 0 }],
    // Another port on the same address is another origin.
    ["POST", "/tailnet/pair", { origin: "http://100.64.0.1:9999" }, { status: 403, mints: 0 }],
    // Minting follows the confirm form's navigation, not a fetch.
    [
      "POST",
      "/tailnet/pair",
      { ...SAME_ORIGIN_FORM, "sec-fetch-mode": "cors" },
      { status: 403, mints: 0 },
    ],
    ["GET", "/tailnet", OTHER_SITE_FETCH, { status: 403, mints: 0 }],
    [
      "OPTIONS",
      "/tailnet/pair",
      { ...OTHER_SITE_FETCH, "access-control-request-method": "POST" },
      { status: 404, mints: 0 },
    ],
    // A link from another server's list is a navigation, which no site can read, and mints nothing.
    [
      "GET",
      "/tailnet/pair",
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" },
      { status: 200, mints: 0 },
    ],
    // A sandboxed frame or a no-referrer page sends an opaque origin.
    ["POST", "/tailnet/pair", { ...SAME_ORIGIN_FORM, origin: "null" }, { status: 403, mints: 0 }],
    ["POST", "/tailnet/pair", SAME_ORIGIN_FORM, { status: 200, mints: 1 }],
    // Non-browser clients send no provenance headers.
    ["POST", "/tailnet/pair", {}, { status: 200, mints: 1 }],
    // The router also matches these spellings, so CORS must not come back through them.
    ...["/TAILNET/pair", "//tailnet/pair", "/tailne%74/pair", "/tailnet/pair/"].flatMap(
      (path) =>
        [
          ["POST", path, OTHER_SITE_FETCH, { status: 403, mints: 0 }],
          ["POST", path, {}, { status: 200, mints: 1 }],
          [
            "OPTIONS",
            path,
            { ...OTHER_SITE_FETCH, "access-control-request-method": "POST" },
            { status: 404, mints: 0 },
          ],
        ] as const,
    ),
  ];
  for (const [method, path, headers, expected] of cases) {
    const result = await send(method, path, headers);
    assert.deepEqual(
      result,
      { ...expected, cors: null },
      `${method} ${path} ${JSON.stringify(headers)}`,
    );
  }
});

it("keeps answering any origin on the browser API", async () => {
  const result = await send("OPTIONS", "/api/environment", {
    ...OTHER_SITE_FETCH,
    "access-control-request-method": "GET",
  });
  assert.equal(result.cors, "*");
});
