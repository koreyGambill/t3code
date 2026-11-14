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
  A value with no upstream equivalent is withheld instead: event-scheduled tasks leave their task
  list, and the server refuses to change, run or delete one for them with a `ScheduledTaskError`.
  A fork client built before a flag existed gets upstream's shape for it until it updates. That is
  accepted, because a missing flag has to mean an upstream client.
- **Behavior upstream clients cannot change can be steered with values they already know.**
  Upstream clients fold every assistant text of a settled turn except its last into "Worked for"
  unless its `phase` is `final_answer`, so answers written between tool calls were hidden on the
  App Store app. Without `assistantTextParts`, every assistant text turn item goes out as
  `final_answer` on the thread stream, `getThreadProjection`, `getTurnItem` and the history page,
  which takes the same `clientCapabilities` list as a query parameter. Their zen mode then shows
  those texts too.
- **Methods upstream clients call stay served** under the same names and request shapes. A feature
  the fork dropped answers with a typed error upstream clients show: `projects.createFromThread`
  points to Change folder, and `threadProjectFromScratch` stays unadvertised so they hide the action.

`apps/server/src/upstreamClientCompat.test.ts` enforces the rule against a pinned bundle of
upstream's contracts. It decodes sampled upstream requests with the fork's schemas. It also decodes
the fork's mapped RPC responses, stream items and errors, and every HTTP endpoint's responses, with
upstream's schemas. Each value the fork adds is forced into samples: an enum member in place of a
sibling, and a new union member, such as a schedule type or an error, sampled whole where its union
sits. `check:changed` runs it for any change to `packages/contracts/src`, `ws.ts` or
the compatibility module. After each upstream merge, refresh the bundle with
`git fetch upstream && vp run upstream-contracts:refresh`, then run the test. To check another
upstream commit without replacing the pinned bundle, set `UPSTREAM_SNAPSHOT` to a path under
`apps/server/node_modules/.cache` for both the refresh and the test. Its `KNOWN_GAPS` list
names accepted exceptions. Each entry is asserted to still fail, so it is removed once fixed.
