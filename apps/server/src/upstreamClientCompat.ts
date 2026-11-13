import {
  OrchestrationDispatchCommandError,
  PEER_LINK_UNAUTHORIZED_STATUS_CAPABILITY,
  SCHEDULED_TASK_SKIPPED_STATUS_CAPABILITY,
  SETTINGS_SECRET_REFERENCES_CAPABILITY,
  TERMINAL_WORKSPACE_CHANGED_ERROR_CAPABILITY,
  TerminalCwdStatError,
  TerminalWorkspaceChangedError,
  WS_METHODS,
  type TerminalError,
  type PeerLinkSummary,
  type ScheduledTask,
  type ScheduledTaskListResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type * as TerminalManager from "./terminal/Manager.ts";

const isTerminalWorkspaceChangedError = Schema.is(TerminalWorkspaceChangedError);

/**
 * Wire shapes the connected client declared through `clientCapabilities`. Upstream T3 Code clients
 * decode the fork's additions strictly, so a value they never declared is mapped to their nearest one.
 * docs/internals/fork-wire-compatibility.md has the rule; upstreamClientCompat.test.ts enforces it.
 */
export interface ClientWireCapabilities {
  readonly secretReferences: boolean;
  readonly scheduledTaskSkippedStatus: boolean;
  readonly peerLinkUnauthorizedStatus: boolean;
  readonly terminalWorkspaceChangedError: boolean;
}

export function readClientWireCapabilities(param: string | null): ClientWireCapabilities {
  const declared = new Set(param?.split(",") ?? []);
  return {
    secretReferences: declared.has(SETTINGS_SECRET_REFERENCES_CAPABILITY),
    scheduledTaskSkippedStatus: declared.has(SCHEDULED_TASK_SKIPPED_STATUS_CAPABILITY),
    peerLinkUnauthorizedStatus: declared.has(PEER_LINK_UNAUTHORIZED_STATUS_CAPABILITY),
    terminalWorkspaceChangedError: declared.has(TERMINAL_WORKSPACE_CHANGED_ERROR_CAPABILITY),
  };
}

// A skipped check-in ran its check and found nothing to do.
function scheduledTaskForClient(task: ScheduledTask, client: ClientWireCapabilities) {
  return task.lastRunStatus === "skipped" && !client.scheduledTaskSkippedStatus
    ? { ...task, lastRunStatus: "succeeded" as const }
    : task;
}

const scheduledTaskResultForClient = <Result extends { readonly task: ScheduledTask }>(
  result: Result,
  client: ClientWireCapabilities,
): Result => ({ ...result, task: scheduledTaskForClient(result.task, client) });

/** Response mappers by RPC method; ws.ts applies each to its method's results. */
export const responseForClient = {
  [WS_METHODS.scheduledTasksSubscribe]: (
    result: ScheduledTaskListResult,
    client: ClientWireCapabilities,
  ): ScheduledTaskListResult =>
    client.scheduledTaskSkippedStatus
      ? result
      : { ...result, tasks: result.tasks.map((task) => scheduledTaskForClient(task, client)) },
  [WS_METHODS.scheduledTasksUpsert]: scheduledTaskResultForClient,
  [WS_METHODS.scheduledTasksSetEnabled]: scheduledTaskResultForClient,
  [WS_METHODS.scheduledTasksRunNow]: scheduledTaskResultForClient,
  [WS_METHODS.scheduledTasksRotateWebhookToken]: scheduledTaskResultForClient,
  // An unauthorized link must be linked again, as an expired one must.
  [WS_METHODS.peerLinksList]: (
    result: { readonly links: ReadonlyArray<PeerLinkSummary> },
    client: ClientWireCapabilities,
  ) =>
    client.peerLinkUnauthorizedStatus
      ? result
      : {
          links: result.links.map((link) =>
            link.status === "unauthorized" ? { ...link, status: "expired" as const } : link,
          ),
        },
};

// Upstream clients print a terminal failure's message and match no tag. This error's message reads
// "Failed to access terminal cwd: <cwd>", so the fork's sentence in `cwd` keeps its text.
const terminalErrorForClient = (
  error: TerminalError,
  client: ClientWireCapabilities,
): TerminalError =>
  isTerminalWorkspaceChangedError(error) && !client.terminalWorkspaceChangedError
    ? new TerminalCwdStatError({ cwd: error.message, cause: error })
    : error;

/** Error mappers by RPC method; terminalManagerForClient applies them. */
export const errorForClient = {
  [WS_METHODS.terminalOpen]: terminalErrorForClient,
  [WS_METHODS.terminalAttach]: terminalErrorForClient,
  [WS_METHODS.terminalObserve]: terminalErrorForClient,
  [WS_METHODS.terminalWrite]: terminalErrorForClient,
  [WS_METHODS.terminalResize]: terminalErrorForClient,
  [WS_METHODS.terminalClear]: terminalErrorForClient,
  [WS_METHODS.terminalClose]: terminalErrorForClient,
};

/** The terminal manager as one connection's RPC handlers see it. */
export function terminalManagerForClient(
  manager: TerminalManager.TerminalManager["Service"],
  client: ClientWireCapabilities,
): TerminalManager.TerminalManager["Service"] {
  if (client.terminalWorkspaceChangedError) return manager;
  const forClient = (error: TerminalError) => terminalErrorForClient(error, client);
  return {
    ...manager,
    open: (...args) => Effect.mapError(manager.open(...args), forClient),
    attachOutputStream: (...args) =>
      Stream.mapError(manager.attachOutputStream(...args), forClient),
    observeStream: (...args) => Effect.mapError(manager.observeStream(...args), forClient),
    resyncStream: (...args) => Effect.mapError(manager.resyncStream(...args), forClient),
    write: (...args) => Effect.mapError(manager.write(...args), forClient),
    resize: (...args) => Effect.mapError(manager.resize(...args), forClient),
    clear: (...args) => Effect.mapError(manager.clear(...args), forClient),
    close: (...args) => Effect.mapError(manager.close(...args), forClient),
  };
}

/**
 * Upstream clients' "Turn into project". This server keeps a thread's project and moves it by
 * changing its folder, and it leaves `threadProjectFromScratch` unadvertised so they hide the action.
 */
export const createProjectFromThread = Effect.fail(
  new OrchestrationDispatchCommandError({
    message:
      "This server does not turn threads into projects. Use Change folder in the thread's menu of this server's T3 Code app to move the thread.",
  }),
);
