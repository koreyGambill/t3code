import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { maxNotificationSeverity } from "@t3tools/client-runtime/state/notifications";
import { AsyncResult } from "effect/reactivity";

import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";
import { useEnvironments } from "./environments";
import { serverEnvironment } from "./server";
import { useEnvironmentsWithScope } from "./session";

const inboxesAtom = environmentAtomList("web-notification-inboxes", (environmentId) =>
  serverEnvironment.notificationsLive({ environmentId, input: {} }),
);

/** Each connected environment that keeps an inbox, with its folded notifications. */
export function useInboxEnvironments() {
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      environment.serverConfig?.environment.capabilities.notifications === true &&
      readable.has(environment.environmentId),
  );
  const results = useAtomValue(
    inboxesAtom(environmentIdsKey(connected.map((entry) => entry.environmentId))),
  );
  return connected.map((environment, index) => ({
    environment,
    inbox: AsyncResult.getOrElse(results[index]!, () => null),
    failed: AsyncResult.isFailure(results[index]!),
  }));
}

/** Unread notifications across environments and the most severe of them, for badges. */
export function useInboxSignal() {
  const groups = useInboxEnvironments();
  return {
    unread: groups.reduce((total, group) => total + (group.inbox?.unreadCount ?? 0), 0),
    severity: maxNotificationSeverity(
      groups.map((group) => group.inbox?.maxUnreadSeverity ?? null),
    ),
  };
}
