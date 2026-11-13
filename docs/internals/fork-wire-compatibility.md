# Fork wire compatibility

This fork's server must keep serving unmodified upstream T3 Code clients, such as the App Store app
and app.t3.codes. Those clients decode every response with upstream's contracts, so one value they
do not know can fail a request or a whole screen. A list decoded with `ForwardCompatibleArray` drops
the item instead, which hides a scheduled task without an error.

The rule for changes to `packages/contracts` that cross the wire:

- **Fields the fork adds are optional** for whoever receives them. A request field the server needs
  gets a decoding default (`Schema.withDecodingDefaultKey`), because upstream clients never send it.
  Upstream clients ignore response fields they do not know.
- **Values the fork adds to an existing enum or union are never sent to upstream clients.** Gate each
  one behind a `clientCapabilities` flag (constants in `packages/contracts/src/environment.ts`) that
  the fork's clients declare in `packages/client-runtime/src/connection/compatibility.ts`. The server
  maps the value to upstream's nearest one for any client that has not declared the flag. The
  mappings live in `apps/server/src/upstreamClientCompat.ts`, and `ws.ts` applies them.
  `skipped` scheduled-task runs become `succeeded`, `unauthorized` peer links become `expired`, and
  `TerminalWorkspaceChangedError` becomes a `TerminalCwdStatError` whose rendered message carries its text.
- **Methods upstream clients call stay served** under the same names and request shapes. A feature
  the fork dropped answers with a typed error upstream clients show: `projects.createFromThread`
  points to Change folder, and `threadProjectFromScratch` stays unadvertised so they hide the action.

`apps/server/src/upstreamClientCompat.test.ts` enforces the rule against a pinned bundle of
upstream's contracts. It decodes sampled upstream requests with the fork's schemas. It also decodes
the fork's mapped responses, stream items and errors with upstream's schemas, and forces each new enum
member into a sample. `check:changed` runs it for any change to `packages/contracts/src`, `ws.ts` or
the compatibility module. After each upstream merge, refresh the bundle with
`git fetch upstream && vp run upstream-contracts:refresh`, then run the test. Its `KNOWN_GAPS` list
names accepted exceptions. Each entry is asserted to still fail, so it is removed once fixed.
