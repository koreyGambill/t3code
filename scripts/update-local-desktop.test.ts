// @effect-diagnostics nodeBuiltinImport:off - Fixtures exercise the standalone worker without Effect dependencies.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { expect, it, vi } from "vite-plus/test";

import { captureLocalLinks, checkLocalLink } from "./update-local-desktop.ts";

function linkFixture(source = "wsl", target = "windows") {
  const userdata = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "update-links-"));
  NodeFS.writeFileSync(NodePath.join(userdata, "environment-id"), source);
  NodeFS.mkdirSync(NodePath.join(userdata, "secrets"));
  const credential = NodePath.join(userdata, "secrets/peer-link-fixture.bin");
  NodeFS.writeFileSync(credential, "existing-peer-token");
  const db = new NodeSqlite.DatabaseSync(NodePath.join(userdata, "statev2.sqlite"));
  db.exec(
    "CREATE TABLE peer_environment_links(environment_id TEXT, urls_json TEXT, linked_at TEXT, secret_name TEXT)",
  );
  db.prepare("INSERT INTO peer_environment_links VALUES (?, ?, ?, ?)").run(
    target,
    '["http://peer.test:3773"]',
    "original-link",
    "peer-link-fixture",
  );
  db.close();
  return {
    userdata,
    credential,
    [Symbol.dispose]() {
      NodeFS.rmSync(userdata, { recursive: true, force: true });
    },
  };
}

function peerResponse(input: string | URL | Request, init?: RequestInit, target = "windows") {
  if (String(input).endsWith("/.well-known/t3/environment"))
    return Response.json({
      environmentId: target,
      capabilities: { mcpModeLimitHeader: true, linkFence: true },
    });
  if (init?.method === "DELETE") return new Response(null, { status: 204 });
  if (new Headers(init?.headers).get("authorization") !== "Bearer existing-peer-token")
    return new Response(null, { status: 401 });
  const message = JSON.parse(String(init?.body));
  if (message.method === "initialize")
    return Response.json({ result: {} }, { headers: { "mcp-session-id": "fixture-session" } });
  if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (message.params?.name !== "t3_thread_list")
    throw new Error("Only the read-only probe is allowed");
  return Response.json({ result: { structuredContent: { total: 0 } } });
}

it.each([
  ["wsl", "windows"],
  ["windows", "wsl"],
])("proves %s → %s with the existing identity, URL and credential", async (source, target) => {
  using fixture = linkFixture(source, target);
  using _fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => peerResponse(input, init, target));
  const before = await captureLocalLinks(fixture.userdata);
  expect(before).toEqual({
    environmentId: source,
    links: [{ environmentId: target, urls: ["http://peer.test:3773"], linkedAt: "original-link" }],
  });
  expect(await checkLocalLink(fixture.userdata, before, target, 10)).toMatchObject({
    sourceEnvironmentId: source,
    targetEnvironmentId: target,
    status: "passed",
    descriptor: true,
    mcp: true,
    url: "http://peer.test:3773",
    error: "",
  });
  expect(NodeFS.readFileSync(fixture.credential, "utf8")).toBe("existing-peer-token");
  expect(await captureLocalLinks(fixture.userdata)).toEqual(before);
});

it.each(["starting", "wrong-identity", "missing-capability", "deadline"])(
  "withholds credentials when the descriptor is %s",
  async (failure) => {
    using fixture = linkFixture();
    const before = await captureLocalLinks(fixture.userdata);
    using fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      failure === "starting"
        ? new Response(null, { status: 503 })
        : Response.json({
            environmentId: failure === "wrong-identity" ? "other" : "windows",
            capabilities: { mcpModeLimitHeader: true, linkFence: failure !== "missing-capability" },
          }),
    );
    expect(
      await checkLocalLink(fixture.userdata, before, "windows", failure === "deadline" ? 0 : 10),
    ).toMatchObject({
      status: "warning",
      descriptor: false,
      mcp: false,
    });
    expect(
      fetch.mock.calls.every(([, init]) => !new Headers(init?.headers).has("authorization")),
    ).toBe(true);
  },
);

it.each(["refused", "tool-error", "malformed"])(
  "records a safe warning when authenticated MCP is %s",
  async (failure) => {
    using fixture = linkFixture();
    const before = await captureLocalLinks(fixture.userdata);
    using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/mcp") && init?.method === "POST") {
        if (failure === "refused") return new Response(null, { status: 401 });
        if (JSON.parse(String(init.body)).method === "tools/call")
          return Response.json({
            result:
              failure === "tool-error"
                ? { isError: true, content: [{ text: "existing-peer-token" }] }
                : {},
          });
      }
      return peerResponse(input, init);
    });
    const result = await checkLocalLink(fixture.userdata, before, "windows", 10);
    expect(result).toMatchObject({
      status: "warning",
      descriptor: true,
      mcp: false,
      error: "Authenticated read-only MCP check failed with the existing peer credential",
    });
    expect(JSON.stringify(result)).not.toContain("existing-peer-token");
  },
);

it.each(["identity", "link"])("warns when the original %s was replaced", async (failure) => {
  using fixture = linkFixture();
  const before = await captureLocalLinks(fixture.userdata);
  if (failure === "identity")
    NodeFS.writeFileSync(NodePath.join(fixture.userdata, "environment-id"), "replacement");
  else {
    const db = new NodeSqlite.DatabaseSync(NodePath.join(fixture.userdata, "statev2.sqlite"));
    db.exec("UPDATE peer_environment_links SET linked_at = 'replacement'");
    db.close();
  }
  using fetch = vi.spyOn(globalThis, "fetch");
  expect(await checkLocalLink(fixture.userdata, before, "windows", 10)).toMatchObject({
    status: "warning",
    descriptor: false,
    mcp: false,
  });
  expect(fetch).not.toHaveBeenCalled();
});
