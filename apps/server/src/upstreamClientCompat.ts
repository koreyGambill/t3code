import {
  PEER_LINK_UNAUTHORIZED_STATUS_CAPABILITY,
  SCHEDULED_TASK_SKIPPED_STATUS_CAPABILITY,
  SETTINGS_SECRET_REFERENCES_CAPABILITY,
  WS_METHODS,
  type PeerLinkSummary,
  type ScheduledTask,
  type ScheduledTaskListResult,
} from "@t3tools/contracts";

/**
 * Wire shapes the connected client declared through `clientCapabilities`. Upstream T3 Code clients
 * decode the fork's additions strictly, so a value they never declared is mapped to their nearest one.
 * docs/internals/fork-wire-compatibility.md has the rule; upstreamClientCompat.test.ts enforces it.
 */
export interface ClientWireCapabilities {
  readonly secretReferences: boolean;
  readonly scheduledTaskSkippedStatus: boolean;
  readonly peerLinkUnauthorizedStatus: boolean;
}

export function readClientWireCapabilities(param: string | null): ClientWireCapabilities {
  const declared = new Set(param?.split(",") ?? []);
  return {
    secretReferences: declared.has(SETTINGS_SECRET_REFERENCES_CAPABILITY),
    scheduledTaskSkippedStatus: declared.has(SCHEDULED_TASK_SKIPPED_STATUS_CAPABILITY),
    peerLinkUnauthorizedStatus: declared.has(PEER_LINK_UNAUTHORIZED_STATUS_CAPABILITY),
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
