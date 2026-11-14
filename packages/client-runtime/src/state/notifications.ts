import type {
  Notification,
  NotificationSeverity,
  NotificationStreamEvent,
} from "@t3tools/contracts";

/** One environment's inbox, folded from `notifications.subscribe`. */
export interface NotificationInbox {
  readonly unreadCount: number;
  readonly maxUnreadSeverity: NotificationSeverity | null;
  /** Newest raise first. */
  readonly items: ReadonlyArray<Notification>;
}

export const EMPTY_NOTIFICATION_INBOX: NotificationInbox = {
  unreadCount: 0,
  maxUnreadSeverity: null,
  items: [],
};

// Upserts can outlive the snapshot's 200-row window; past this the oldest rows drop.
const MAX_ITEMS = 500;

const newestFirst = (a: Notification, b: Notification) =>
  a.updatedAt === b.updatedAt
    ? b.createdAt.localeCompare(a.createdAt)
    : b.updatedAt.localeCompare(a.updatedAt);

export function applyNotificationEvent(
  inbox: NotificationInbox,
  event: NotificationStreamEvent,
): NotificationInbox {
  const counts = { unreadCount: event.unreadCount, maxUnreadSeverity: event.maxUnreadSeverity };
  if (event.type === "snapshot") return { ...counts, items: event.items };
  const changed = new Set(event.items.map((item) => item.id));
  const items = [...event.items, ...inbox.items.filter((item) => !changed.has(item.id))]
    .sort(newestFirst)
    .slice(0, MAX_ITEMS);
  return { ...counts, items };
}

export type NotificationTab = "inbox" | "snoozed" | "dismissed";

export function notificationTab(item: Notification, nowMs: number): NotificationTab {
  if (item.dismissedAt !== null) return "dismissed";
  if (item.snoozedUntil !== null && Date.parse(item.snoozedUntil) > nowMs) return "snoozed";
  return "inbox";
}

export const NOTIFICATION_SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function maxNotificationSeverity(
  severities: Iterable<NotificationSeverity | null>,
): NotificationSeverity | null {
  let max: NotificationSeverity | null = null;
  for (const severity of severities)
    if (
      severity !== null &&
      (max === null || NOTIFICATION_SEVERITY_RANK[severity] > NOTIFICATION_SEVERITY_RANK[max])
    )
      max = severity;
  return max;
}

/**
 * Picks the items worth an OS alert: a warning or critical that is unread in the inbox tab and was
 * just raised (or raised again), or whose snooze just ended. The first observation only primes,
 * and the viewer's own actions (mark unread, restore, unsnooze) never alert.
 */
export function createNotificationAlertGate() {
  let primed = false;
  let newest = "";
  let snoozed = new Map<string, boolean>();
  return {
    observe(items: ReadonlyArray<Notification>, nowMs: number): ReadonlyArray<Notification> {
      const alerts: Notification[] = [];
      const next = new Map<string, boolean>();
      let nextNewest = newest;
      for (const item of items) {
        const tab = notificationTab(item, nowMs);
        next.set(item.id, tab === "snoozed");
        if (item.updatedAt > nextNewest) nextNewest = item.updatedAt;
        if (!primed || item.severity === "info" || item.readAt !== null || tab !== "inbox")
          continue;
        // A repeat moves updatedAt; a restore or mark-unread of an older row does not.
        const raised = item.updatedAt > newest;
        // The server keeps an ended snooze's time; an unsnooze clears it.
        const woke = snoozed.get(item.id) === true && item.snoozedUntil !== null;
        if (raised || woke) alerts.push(item);
      }
      primed = true;
      newest = nextNewest;
      snoozed = next;
      return alerts;
    },
  };
}
