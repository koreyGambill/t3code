import { NotificationId, ThreadId, type Notification } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyNotificationEvent,
  createNotificationAlertGate,
  EMPTY_NOTIFICATION_INBOX,
  notificationTab,
} from "./notifications.ts";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");

const item = (id: string, overrides: Partial<Notification> = {}): Notification => ({
  id: NotificationId.make(id),
  createdAt: "2026-11-14T10:00:00.000Z",
  updatedAt: "2026-11-14T10:00:00.000Z",
  severity: "warning",
  title: id,
  source: { kind: "agent", threadId: ThreadId.make("t1") },
  threadId: ThreadId.make("t1"),
  projectId: null,
  readAt: null,
  dismissedAt: null,
  snoozedUntil: null,
  repeatCount: 0,
  ...overrides,
});

describe("notification inbox", () => {
  it("replaces on a snapshot and merges upserts newest raise first", () => {
    const snapshot = applyNotificationEvent(EMPTY_NOTIFICATION_INBOX, {
      type: "snapshot",
      unreadCount: 2,
      maxUnreadSeverity: "warning",
      items: [item("b", { updatedAt: "2026-11-14T11:00:00.000Z" }), item("a")],
    });
    const repeated = applyNotificationEvent(snapshot, {
      type: "upsert",
      unreadCount: 3,
      maxUnreadSeverity: "critical",
      items: [
        item("a", { updatedAt: "2026-11-14T11:30:00.000Z", repeatCount: 1 }),
        item("c", { severity: "critical", updatedAt: "2026-11-14T11:15:00.000Z" }),
      ],
    });
    expect(repeated.items.map((entry) => [entry.id, entry.repeatCount])).toEqual([
      ["a", 1],
      ["c", 0],
      ["b", 0],
    ]);
    expect(repeated).toMatchObject({ unreadCount: 3, maxUnreadSeverity: "critical" });
    const counts = applyNotificationEvent(repeated, {
      type: "upsert",
      unreadCount: 0,
      maxUnreadSeverity: null,
      items: [],
    });
    expect(counts).toMatchObject({ unreadCount: 0, maxUnreadSeverity: null });
    expect(counts.items).toHaveLength(3);
  });

  it("files items under the tab their state names, ending snoozes by the clock", () => {
    expect(notificationTab(item("a"), NOW)).toBe("inbox");
    expect(notificationTab(item("a", { snoozedUntil: "2026-11-14T13:00:00.000Z" }), NOW)).toBe(
      "snoozed",
    );
    expect(notificationTab(item("a", { snoozedUntil: "2026-11-14T11:00:00.000Z" }), NOW)).toBe(
      "inbox",
    );
    expect(
      notificationTab(
        item("a", {
          dismissedAt: "2026-11-14T11:00:00.000Z",
          snoozedUntil: "2026-11-14T13:00:00.000Z",
        }),
        NOW,
      ),
    ).toBe("dismissed");
  });
});

describe("notification alert gate", () => {
  it("alerts on new raises, repeats and ended snoozes, never on the viewer's own actions", () => {
    const gate = createNotificationAlertGate();
    const read = item("read", { readAt: "2026-11-14T10:30:00.000Z" });
    const snoozed = item("snoozed", { snoozedUntil: "2026-11-14T12:30:00.000Z" });
    expect(gate.observe([item("old"), read, snoozed], NOW)).toEqual([]);

    const raised = item("new", { severity: "critical", updatedAt: "2026-11-14T11:59:00.000Z" });
    const info = item("info", { severity: "info", updatedAt: "2026-11-14T11:59:00.000Z" });
    expect(gate.observe([raised, info, item("old"), read, snoozed], NOW).map((x) => x.id)).toEqual([
      "new",
    ]);

    // Mark unread and restore leave updatedAt alone.
    const unread = { ...read, readAt: null };
    expect(gate.observe([raised, unread, item("old"), snoozed], NOW)).toEqual([]);

    const repeat = { ...unread, updatedAt: "2026-11-14T12:01:00.000Z", repeatCount: 1 };
    expect(gate.observe([repeat, raised, snoozed], NOW).map((x) => x.id)).toEqual(["read"]);

    // The snooze ends: the server keeps its time and republishes the row.
    const later = Date.parse("2026-11-14T12:31:00.000Z");
    expect(gate.observe([repeat, raised, snoozed], later).map((x) => x.id)).toEqual(["snoozed"]);
  });

  it("stays quiet when the viewer unsnoozes", () => {
    const gate = createNotificationAlertGate();
    const snoozed = item("s", { snoozedUntil: "2026-11-14T13:00:00.000Z" });
    gate.observe([snoozed], NOW);
    expect(gate.observe([{ ...snoozed, snoozedUntil: null }], NOW)).toEqual([]);
  });
});
