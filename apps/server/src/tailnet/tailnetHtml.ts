// @effect-diagnostics-next-line nodeBuiltinImport:off -- hashes a fixed script once, at module load, for the CSP.
import * as NodeCrypto from "node:crypto";

import { QrCode } from "@t3tools/shared/qrCode";

import {
  TAILNET_PAGE_PATH,
  TAILNET_PAIR_PATH,
  type TailnetCaller,
  type TailnetEnvironmentEntry,
  type TailnetPairing,
} from "./TailnetConnect.ts";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

// The mobile app's Add environment form; production builds ignore a prefilled link, so the user pastes.
const MOBILE_ADD_ENVIRONMENT_LINK = "t3code://connections/new";

const COPY_SCRIPT = `document.querySelectorAll("[data-copy]").forEach(function (button) {
  button.addEventListener("click", function () {
    var input = document.getElementById(button.getAttribute("data-copy"));
    var done = function () { button.textContent = "Copied"; };
    var fallback = function () { input.focus(); input.select(); input.setSelectionRange(0, input.value.length); document.execCommand("copy"); done(); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(input.value).then(done, fallback);
    else fallback();
  });
});`;

const COPY_SCRIPT_HASH = NodeCrypto.createHash("sha256").update(COPY_SCRIPT).digest("base64");

export const TAILNET_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${COPY_SCRIPT_HASH}'; form-action 'self'; frame-ancestors 'none'`,
  "x-frame-options": "DENY",
  "cache-control": "no-store",
  pragma: "no-cache",
  // Not no-referrer: browsers then send `Origin: null` on the form's own POST, which the mint refuses.
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
};

const STYLES = `
  :root {
    color-scheme: light dark;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --bg: #f6f7f9; --card: #ffffff; --fg: #17191f; --muted: #5b6070; --border: #e2e4ea;
    --button: #17191f; --button-fg: #ffffff; --soft: #eef0f4;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --card: #171a20; --fg: #e6e8ee; --muted: #9aa0ae; --border: #2a2e37;
      --button: #e6e8ee; --button-fg: #111318; --soft: #222630;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; padding: 32px 16px; background: var(--bg); color: var(--fg); }
  main { width: min(100%, 460px); margin: 0 auto; }
  h1 { margin: 0 0 6px; font-size: 20px; line-height: 1.3; overflow-wrap: anywhere; }
  h2 { margin: 0 0 8px; font-size: 14px; }
  p { margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px; margin-top: 16px; }
  .list { list-style: none; margin: 16px 0 0; padding: 0; background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; min-height: 60px; }
  .row + .row { border-top: 1px solid var(--border); }
  .row-text { flex: 1; min-width: 0; }
  .row-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row-sub { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: var(--soft); color: var(--muted); font-size: 11px; font-weight: 500; vertical-align: 1px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .button { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 14px; border-radius: 9px; border: 1px solid var(--button); background: var(--button); color: var(--button-fg); font: inherit; font-size: 14px; font-weight: 500; text-decoration: none; cursor: pointer; white-space: nowrap; }
  .button.secondary { background: transparent; color: var(--fg); border-color: var(--border); }
  .button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
  .field { display: flex; gap: 8px; margin-top: 12px; }
  .field input { flex: 1; min-width: 0; min-height: 36px; padding: 0 10px; border-radius: 9px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .qr { display: block; width: 184px; height: 184px; padding: 8px; margin: 4px auto 0; border-radius: 12px; background: #ffffff; }
  .foot { margin-top: 16px; font-size: 13px; }
  .foot a { color: var(--fg); }
`;

const shell = (title: string, body: string, withScript = false) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="referrer" content="same-origin" />
    <title>${escapeHtml(title)}</title>
    <style>${STYLES}</style>
  </head>
  <body>
    <main>${body}</main>${withScript ? `\n    <script>${COPY_SCRIPT}</script>` : ""}
  </body>
</html>`;

const callerLine = (caller: TailnetCaller) =>
  `Signed in to Tailscale as <strong>${escapeHtml(caller.login)}</strong>${
    caller.nodeName === null ? "" : ` on ${escapeHtml(caller.nodeName)}`
  }.`;

const qrSvg = (value: string) => {
  const qr = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
  const path: Array<string> = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.getModule(x, y)) path.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return `<svg class="qr" viewBox="0 0 ${qr.size} ${qr.size}" role="img" aria-label="Pairing link QR code" shape-rendering="crispEdges"><path fill="#000" d="${path.join("")}"/></svg>`;
};

export function renderEnvironmentsPage(input: {
  readonly caller: TailnetCaller;
  readonly environments: ReadonlyArray<TailnetEnvironmentEntry>;
}): string {
  const labels = input.environments.map((environment) => environment.label);
  const rows = input.environments
    .map(
      (environment) => `<li class="row">
        <div class="row-text">
          <div class="row-title">${escapeHtml(environment.label)}${
            environment.current ? `<span class="badge">This server</span>` : ""
          }</div>
          <div class="row-sub">${escapeHtml(
            [
              environment.machine === environment.label &&
              labels.indexOf(environment.label) === labels.lastIndexOf(environment.label)
                ? null
                : environment.machine,
              environment.address,
            ]
              .filter((part) => part !== null && part !== "")
              .join(" · "),
          )}</div>
        </div>
        <a class="button" href="${escapeHtml(environment.pairUrl)}">Pair</a>
      </li>`,
    )
    .join("");
  return shell(
    "Pair over Tailscale",
    `<h1>Pair over Tailscale</h1>
    <p>${callerLine(input.caller)} Pair this device with any T3 Code server on your machines.</p>
    <ul class="list">${rows}</ul>
    <p class="foot">Each server checks your Tailscale login itself, so a server whose tailnet pairing is off says so when you open it.</p>`,
  );
}

export function renderPairingPage(input: {
  readonly pairing: TailnetPairing;
  readonly expiresInMinutes: number;
}): string {
  const { pairing } = input;
  const url = escapeHtml(pairing.pairingUrl);
  return shell(
    `Pair with ${pairing.environmentLabel}`,
    `<h1>Pair with ${escapeHtml(pairing.environmentLabel)}</h1>
    <p>${callerLine(pairing.caller)} This link pairs one device, once, within ${input.expiresInMinutes} minutes.</p>
    <section class="card">
      <h2>T3 Code on this phone</h2>
      <p>Copy the link, open the app, then paste it into Address under Add environment.</p>
      <div class="actions">
        <button type="button" class="button" data-copy="pairing-url">Copy link</button>
        <a class="button secondary" href="${MOBILE_ADD_ENVIRONMENT_LINK}">Open T3 Code app</a>
      </div>
      <div class="field"><input id="pairing-url" readonly value="${url}" aria-label="Pairing link" /></div>
    </section>
    <section class="card">
      <h2>T3 Code desktop or this browser</h2>
      <div class="actions">
        <a class="button" href="${escapeHtml(pairing.appLink)}">Open in T3 Code desktop</a>
        <a class="button secondary" href="${url}">Use this browser</a>
      </div>
    </section>
    <section class="card">
      <h2>Another device</h2>
      <p>Scan with Add environment in the T3 Code app, or with a camera to pair a browser.</p>
      ${qrSvg(pairing.pairingUrl)}
    </section>
    <p class="foot"><a href="${TAILNET_PAGE_PATH}">All environments</a></p>`,
    true,
  );
}

export function renderPairingConfirmPage(input: {
  readonly caller: TailnetCaller;
  readonly environmentLabel: string;
}): string {
  return shell(
    `Pair with ${input.environmentLabel}`,
    `<h1>Pair with ${escapeHtml(input.environmentLabel)}</h1>
    <p>${callerLine(input.caller)} The link you create pairs one device, once, and expires within minutes.</p>
    <form class="card" method="post" action="${TAILNET_PAIR_PATH}">
      <button type="submit" class="button">Create pairing link</button>
    </form>
    <p class="foot"><a href="${TAILNET_PAGE_PATH}">All environments</a></p>`,
  );
}

export function renderRefusalPage(input: {
  readonly message: string;
  readonly listLink: boolean;
}): string {
  return shell(
    "Cannot pair",
    `<h1>This device cannot pair here</h1>
    <p>${escapeHtml(input.message)}</p>${
      input.listLink
        ? `\n    <p class="foot"><a href="${TAILNET_PAGE_PATH}">All environments</a></p>`
        : ""
    }`,
  );
}
