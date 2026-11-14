import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type Notification,
  type NotificationAction,
  type NotificationSeverity,
  type ScheduledTaskId,
} from "@t3tools/contracts";
import { notificationTab, type NotificationTab } from "@t3tools/client-runtime/state/notifications";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SnoozePresetSetting } from "@t3tools/contracts/settings";
import { useNavigate } from "@tanstack/react-router";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  BellIcon,
  CheckCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MailIcon,
  MailOpenIcon,
  MessageSquareIcon,
  Settings2Icon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useThreadShell } from "../../state/entities";
import { useInboxEnvironments } from "../../state/inbox";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  type InboxSelection,
  type InboxTab,
  useThreadContextSidebarStore,
} from "../../threadContextSidebarStore";
import ChatMarkdown from "../ChatMarkdown";
import { useScheduledTaskTitle } from "../chat/TimelineUserMessageRow";
import { WatcherAlerts, useMonitoringSignal } from "../monitoring/WatcherAlerts";
import { RelativeTime } from "../RelativeTime";
import { StatusSourceDot } from "../statusSources/StatusSourceIcon";
import { StatusSourcesList } from "../statusSources/StatusSources";
import { ToolHeaderButton } from "../threadToolsHost";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface InboxItem {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string | null;
  readonly notification: Notification;
}

const SNOOZE_PRESETS: ReadonlyArray<SnoozePresetSetting> = [
  { kind: "after", minutes: 60 },
  { kind: "at", day: "tomorrow", time: "09:00" },
  { kind: "after", minutes: 7 * 24 * 60 },
];

const TABS: ReadonlyArray<{ id: InboxTab; label: string; icon: ReactNode }> = [
  { id: "inbox", label: "Inbox", icon: <BellIcon /> },
  { id: "snoozed", label: "Snoozed", icon: <AlarmClockIcon /> },
  { id: "dismissed", label: "Dismissed", icon: <ArchiveIcon /> },
];

const severityLabel: Record<NotificationSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const severityBar: Record<NotificationSeverity, string | null> = {
  critical: "bg-destructive",
  warning: "bg-warning",
  info: null,
};

const rowKey = (item: { environmentId: string; notification: { id: string } }) =>
  `${item.environmentId}:${item.notification.id}`;

function useNotificationActions(environmentId: EnvironmentId) {
  const permitted = useAtomValue(
    serverEnvironment.updateNotifications.permissionAtom(environmentId),
  );
  const update = useAtomCommand(serverEnvironment.updateNotifications);
  return {
    permitted,
    run: (notification: Notification, action: NotificationAction) =>
      void update({ environmentId, input: { ids: [notification.id], action } }),
  };
}

function SnoozeMenu({
  disabled,
  compact,
  onSnooze,
}: {
  disabled: boolean;
  compact?: boolean;
  /** Returns where focus goes once the snoozed row leaves the list. */
  onSnooze: (until: string) => HTMLElement | null | void;
}) {
  const finalFocus = useRef<HTMLElement | null>(null);
  const [presets, setPresets] = useState<ReturnType<typeof resolveSnoozePresets>>([]);
  return (
    <Menu
      onOpenChange={(open) => {
        if (open) setPresets(resolveSnoozePresets(new Date(), { presets: SNOOZE_PRESETS }));
      }}
    >
      {compact ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Button variant="ghost" size="icon-xs" aria-label="Snooze" disabled={disabled} />
                }
              />
            }
          >
            <AlarmClockIcon />
          </TooltipTrigger>
          <TooltipPopup>Snooze</TooltipPopup>
        </Tooltip>
      ) : (
        <MenuTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
          <AlarmClockIcon />
          Snooze
        </MenuTrigger>
      )}
      <MenuPopup align="end" finalFocus={() => finalFocus.current ?? true}>
        {presets.map((preset) => (
          <MenuItem
            key={preset.id}
            onClick={() => {
              finalFocus.current = onSnooze(preset.snoozedUntil) ?? null;
            }}
          >
            <span className="flex-1">{preset.label}</span>
            <span className="text-muted-foreground">{preset.whenLabel}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function IconAction(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** What raised the notification: the automation's title, or the agent thread's. */
function useSourceLabel(environmentId: EnvironmentId, notification: Notification): string {
  const { source } = notification;
  const taskId: ScheduledTaskId | undefined =
    source.kind === "agent" ? undefined : source.scheduledTaskId;
  const taskTitle = useScheduledTaskTitle(environmentId, taskId);
  const shell = useThreadShell(
    source.kind === "agent" ? scopeThreadRef(environmentId, source.threadId) : null,
  );
  if (source.kind === "agent") return `Agent · ${shell?.title ?? "thread"}`;
  return taskTitle ?? (source.kind === "review" ? "Review" : "Automation");
}

function VerificationChip({ notification }: { notification: Notification }) {
  const verification = notification.verification;
  if (!verification || verification.status === "pending" || verification.status === "rejected")
    return null;
  const model = verification.model?.model;
  return verification.status === "confirmed" ? (
    <Badge variant="success" size="sm">
      Verified{model ? ` · ${model}` : ""}
    </Badge>
  ) : (
    <Badge variant="outline" size="sm">
      Unverified
    </Badge>
  );
}

function InboxRow({
  item,
  tab,
  onOpen,
}: {
  item: InboxItem;
  tab: NotificationTab;
  onOpen: () => void;
}) {
  const { notification, environmentId } = item;
  const actions = useNotificationActions(environmentId);
  const source = useSourceLabel(environmentId, notification);
  const unread = notification.readAt === null;
  const bar = severityBar[notification.severity];
  const itemRef = useRef<HTMLLIElement>(null);
  // The row leaves this tab, so focus moves to its neighbour instead of the page.
  const leave = (action: NotificationAction) => {
    const item = itemRef.current;
    const neighbour = (
      item?.nextElementSibling ?? item?.previousElementSibling
    )?.querySelector<HTMLElement>("[data-inbox-row]");
    neighbour?.focus();
    actions.run(notification, action);
    return neighbour ?? null;
  };
  return (
    <li ref={itemRef} className="group/row relative border-b border-border">
      <button
        type="button"
        data-inbox-row={rowKey(item)}
        className="flex w-full min-w-0 gap-2 py-2 pr-3 pl-3 text-left outline-hidden hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
      >
        {bar ? (
          <span
            aria-hidden
            className={cn("absolute inset-y-1.5 left-0.5 w-0.5 rounded-full", bar)}
          />
        ) : null}
        <span className="flex h-5 w-1.5 shrink-0 items-center">
          {unread ? <span className="size-1.5 rounded-full bg-primary" /> : null}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="sr-only">
            {severityLabel[notification.severity]}
            {unread ? ", unread" : ""}:{" "}
          </span>
          <span
            className={cn(
              "line-clamp-2 text-sm wrap-anywhere",
              unread ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {notification.title}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{source}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">
              <RelativeTime timestamp={notification.updatedAt} />
            </span>
            {notification.repeatCount > 0 ? (
              <span className="shrink-0" aria-label={`repeated ${notification.repeatCount} times`}>
                ×{notification.repeatCount + 1}
              </span>
            ) : null}
          </span>
          {item.environmentLabel || notification.verification ? (
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              <VerificationChip notification={notification} />
              {item.environmentLabel ? (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {item.environmentLabel}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      {/* Hover and focus reveal these; touch reaches them in the detail. */}
      <div className="absolute top-1 right-1 flex items-center gap-0.5 rounded-md bg-sidebar opacity-0 shadow-xs ring-1 ring-border group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:hidden">
        <IconAction
          label={unread ? "Mark read" : "Mark unread"}
          disabled={!actions.permitted}
          onClick={() => actions.run(notification, { type: unread ? "read" : "unread" })}
        >
          {unread ? <MailOpenIcon /> : <MailIcon />}
        </IconAction>
        {tab === "snoozed" ? (
          <IconAction
            label="Unsnooze"
            disabled={!actions.permitted}
            onClick={() => leave({ type: "unsnooze" })}
          >
            <AlarmClockOffIcon />
          </IconAction>
        ) : tab === "inbox" ? (
          <SnoozeMenu
            compact
            disabled={!actions.permitted}
            onSnooze={(until) => leave({ type: "snooze", until })}
          />
        ) : null}
        {tab === "dismissed" ? (
          <IconAction
            label="Restore"
            disabled={!actions.permitted}
            onClick={() => leave({ type: "restore" })}
          >
            <ArchiveRestoreIcon />
          </IconAction>
        ) : (
          <IconAction
            label="Dismiss"
            disabled={!actions.permitted}
            onClick={() => leave({ type: "dismiss" })}
          >
            <ArchiveIcon />
          </IconAction>
        )}
      </div>
    </li>
  );
}

function BackHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border px-1.5 py-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Back to inbox"
        // Opening a detail unmounts the row that had focus.
        autoFocus
        onClick={onBack}
      >
        <ChevronLeftIcon />
      </Button>
      <h3 className="min-w-0 truncate text-sm font-medium">{label}</h3>
    </div>
  );
}

function InboxDetail({ item, onBack }: { item: InboxItem; onBack: () => void }) {
  const { notification, environmentId } = item;
  const navigate = useNavigate();
  const actions = useNotificationActions(environmentId);
  const source = useSourceLabel(environmentId, notification);
  const now = Date.parse(`${useNowMinute()}Z`);
  const tab = notificationTab(notification, now);
  const unread = notification.readAt === null;
  const { verification } = notification;
  return (
    <>
      <BackHeader label="Inbox" onBack={onBack} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        <div className="space-y-1.5">
          <h4 className="font-medium wrap-anywhere">{notification.title}</h4>
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              size="sm"
              variant={
                notification.severity === "critical"
                  ? "error"
                  : notification.severity === "warning"
                    ? "warning"
                    : "secondary"
              }
            >
              {severityLabel[notification.severity]}
            </Badge>
            <VerificationChip notification={notification} />
            {tab === "snoozed" && notification.snoozedUntil ? (
              <Badge size="sm" variant="outline">
                Snoozed until {new Date(notification.snoozedUntil).toLocaleString()}
              </Badge>
            ) : null}
            {tab === "dismissed" ? (
              <Badge size="sm" variant="outline">
                Dismissed
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground wrap-anywhere">
            {source} · <RelativeTime timestamp={notification.updatedAt} />
            {notification.repeatCount > 0 ? ` · raised ${notification.repeatCount + 1} times` : ""}
            {item.environmentLabel ? ` · ${item.environmentLabel}` : ""}
          </p>
        </div>
        {notification.body ? (
          <ChatMarkdown text={notification.body} cwd={undefined} environmentId={environmentId} />
        ) : null}
        {verification?.note ? (
          <figure className="space-y-1 border-l-2 border-border pl-3">
            <figcaption className="text-xs text-muted-foreground">
              Verifier{verification.model ? ` · ${verification.model.model}` : ""}
            </figcaption>
            <p className="whitespace-pre-wrap wrap-anywhere">{verification.note}</p>
          </figure>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-border p-3">
        {notification.threadId ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId: notification.threadId! },
              })
            }
          >
            <MessageSquareIcon />
            Open thread
          </Button>
        ) : null}
        {tab === "snoozed" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!actions.permitted}
            onClick={() => actions.run(notification, { type: "unsnooze" })}
          >
            <AlarmClockOffIcon />
            Unsnooze
          </Button>
        ) : tab === "inbox" ? (
          <SnoozeMenu
            disabled={!actions.permitted}
            onSnooze={(until) => actions.run(notification, { type: "snooze", until })}
          />
        ) : null}
        {tab === "dismissed" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!actions.permitted}
            onClick={() => actions.run(notification, { type: "restore" })}
          >
            <ArchiveRestoreIcon />
            Restore
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={!actions.permitted}
            onClick={() => actions.run(notification, { type: "dismiss" })}
          >
            <ArchiveIcon />
            Dismiss
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={!actions.permitted}
          onClick={() => actions.run(notification, { type: unread ? "read" : "unread" })}
        >
          {unread ? <MailOpenIcon /> : <MailIcon />}
          {unread ? "Mark read" : "Mark unread"}
        </Button>
      </div>
    </>
  );
}

function PanelRow(props: {
  id: "status" | "watchers";
  label: string;
  detail: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-inbox-row={props.id}
      className="flex w-full min-w-0 items-center gap-2 border-b border-border px-3 py-2 text-left text-sm outline-hidden hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={props.onOpen}
    >
      <span className="shrink-0 font-medium">{props.label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
        {props.detail}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function StatusRow({ onOpen }: { onOpen: () => void }) {
  const { state, groups } = useMonitoringSignal();
  const sources = groups.flatMap((group) => group.sources ?? []);
  const failing = sources.filter((source) => source.latest.state === "fail").length;
  const warning = sources.filter((source) => source.latest.state === "warn").length;
  if (groups.length === 0) return null;
  return (
    <PanelRow
      id="status"
      label="Status"
      onOpen={onOpen}
      detail={
        <>
          {state ? <StatusSourceDot state={state} /> : null}
          <span className="truncate">
            {sources.length === 0
              ? "No sources"
              : failing
                ? `${failing} failing`
                : warning
                  ? `${warning} warning${warning === 1 ? "" : "s"}`
                  : "All OK"}
          </span>
        </>
      }
    />
  );
}

function WatchersRow({ onOpen }: { onOpen: () => void }) {
  const { unread } = useMonitoringSignal();
  const inboxEnvironments = useInboxEnvironments();
  const supported = inboxEnvironments.some(
    ({ environment }) => environment.serverConfig?.environment.capabilities.monitoring === true,
  );
  if (!supported && unread === 0) return null;
  return (
    <PanelRow
      id="watchers"
      label="Watcher alerts"
      onOpen={onOpen}
      detail={unread ? <span className="truncate">{unread} unread</span> : null}
    />
  );
}

function InboxList({
  items,
  tab,
  loading,
  failed,
  supported,
  onSelect,
}: {
  items: ReadonlyArray<InboxItem>;
  tab: InboxTab;
  loading: boolean;
  failed: boolean;
  supported: boolean;
  onSelect: (selection: InboxSelection) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {tab === "inbox" ? (
        <>
          <StatusRow onOpen={() => onSelect({ kind: "status" })} />
          <WatchersRow onOpen={() => onSelect({ kind: "watchers" })} />
        </>
      ) : null}
      {failed ? (
        <p role="alert" className="px-3 py-3 text-sm text-muted-foreground">
          Could not load notifications.
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul aria-label={`${TABS.find((entry) => entry.id === tab)!.label} notifications`}>
          {items.map((item) => (
            <InboxRow
              key={rowKey(item)}
              item={item}
              tab={tab}
              onOpen={() =>
                onSelect({
                  kind: "notification",
                  environmentId: item.environmentId,
                  id: item.notification.id,
                })
              }
            />
          ))}
        </ul>
      ) : loading ? (
        <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
          Loading notifications…
        </p>
      ) : failed ? null : (
        <Empty size="compact">
          <EmptyMedia variant="icon">{TABS.find((entry) => entry.id === tab)!.icon}</EmptyMedia>
          <EmptyTitle>
            {!supported
              ? "No inbox here"
              : tab === "inbox"
                ? "You're all caught up"
                : tab === "snoozed"
                  ? "Nothing snoozed"
                  : "Nothing dismissed"}
          </EmptyTitle>
          <EmptyDescription>
            {!supported
              ? "Connect to a server that supports notifications."
              : tab === "inbox"
                ? "Automations and agents post here when something needs you."
                : tab === "snoozed"
                  ? "Snoozed notifications come back to the inbox when their time ends."
                  : "Dismissed notifications stay here so you can restore them."}
          </EmptyDescription>
        </Empty>
      )}
    </div>
  );
}

/** The inbox strip view: tabs, notification rows and detail, and the legacy status panels. */
export function InboxView({ actions }: { actions: HTMLDivElement | null }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const tab = useThreadContextSidebarStore((state) => state.inboxTab);
  const selection = useThreadContextSidebarStore((state) => state.inboxSelection);
  const groups = useInboxEnvironments();
  const markAllRead = useAtomCommand(serverEnvironment.markAllNotificationsRead);
  const now = Date.parse(`${useNowMinute()}Z`);
  const multiple = groups.length > 1;
  const all: InboxItem[] = groups
    .flatMap(({ environment, inbox }) =>
      (inbox?.items ?? []).map((notification) => ({
        environmentId: environment.environmentId,
        environmentLabel: multiple ? environment.label : null,
        notification,
      })),
    )
    .sort((a, b) => b.notification.updatedAt.localeCompare(a.notification.updatedAt));
  const counts = { inbox: 0, snoozed: 0, dismissed: 0 };
  const shown: InboxItem[] = [];
  for (const item of all) {
    const itemTab = notificationTab(item.notification, now);
    counts[itemTab] += 1;
    if (itemTab === tab) shown.push(item);
  }
  const unread = groups.reduce((total, group) => total + (group.inbox?.unreadCount ?? 0), 0);
  const store = useThreadContextSidebarStore.getState;

  const back = () => {
    if (!selection) return;
    const key =
      selection.kind === "notification"
        ? `${selection.environmentId}:${selection.id}`
        : selection.kind;
    flushSync(() => store().selectInbox(null));
    rootRef.current?.querySelector<HTMLElement>(`[data-inbox-row="${CSS.escape(key)}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Menus portal out of this subtree, so their own Escape never lands here.
    if (
      event.key !== "Escape" ||
      !selection ||
      !(event.target instanceof Node) ||
      !rootRef.current?.contains(event.target)
    )
      return;
    event.preventDefault();
    back();
  };
  const markRead = useAtomCommand(serverEnvironment.updateNotifications, { reportFailure: false });
  // Opening an unread notification reads it; the OS-notification path does the same.
  const select = (next: InboxSelection) => {
    store().selectInbox(next);
    if (next.kind !== "notification") return;
    const item = all.find(
      (entry) => entry.environmentId === next.environmentId && entry.notification.id === next.id,
    );
    if (item?.notification.readAt === null)
      void markRead({
        environmentId: item.environmentId,
        input: { ids: [item.notification.id], action: { type: "read" } },
      });
  };

  const selected =
    selection?.kind === "notification"
      ? all.find(
          (entry) =>
            entry.environmentId === selection.environmentId &&
            entry.notification.id === selection.id,
        )
      : undefined;

  return (
    <div
      ref={rootRef}
      className="@container/inbox flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
    >
      {actions
        ? createPortal(
            <>
              <ToolHeaderButton
                label="Mark all read"
                disabled={unread === 0}
                onClick={() => {
                  for (const group of groups)
                    if (group.inbox?.unreadCount)
                      void markAllRead({
                        environmentId: group.environment.environmentId,
                        input: {},
                      });
                }}
              >
                <CheckCheckIcon />
              </ToolHeaderButton>
              <ToolHeaderButton
                label="Notification settings"
                onClick={() => void navigate({ to: "/settings/general", hash: "notifications" })}
              >
                <Settings2Icon />
              </ToolHeaderButton>
            </>,
            actions,
          )
        : null}
      {selection?.kind === "status" ? (
        <>
          <BackHeader label="Status" onBack={back} />
          <StatusPanel />
        </>
      ) : selection?.kind === "watchers" ? (
        <>
          <BackHeader label="Watcher alerts" onBack={back} />
          <WatcherAlerts />
        </>
      ) : selection?.kind === "notification" ? (
        selected ? (
          <InboxDetail key={rowKey(selected)} item={selected} onBack={back} />
        ) : (
          <>
            <BackHeader label="Notification" onBack={back} />
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {groups.some((group) => group.inbox === null)
                ? "Loading notification…"
                : "This notification is no longer available."}
            </p>
          </>
        )
      ) : (
        <>
          <div className="shrink-0 border-b border-border px-2 py-2">
            <ToggleGroup
              aria-label="Inbox filter"
              value={[tab]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "inbox" || value === "snoozed" || value === "dismissed")
                  store().setInboxTab(value);
              }}
            >
              {TABS.map((entry) => (
                <Tooltip key={entry.id}>
                  <TooltipTrigger render={<Toggle value={entry.id} aria-label={entry.label} />}>
                    {/* Every label fits from 16rem; below, only the active tab names itself. */}
                    <span aria-hidden className="flex @[16rem]/inbox:hidden">
                      {entry.icon}
                    </span>
                    <span
                      className={cn(
                        "hidden @[16rem]/inbox:inline",
                        entry.id === tab && "@[13rem]/inbox:inline",
                      )}
                    >
                      {entry.label}
                    </span>
                    {entry.id === "snoozed" && counts.snoozed > 0 ? (
                      <span className="text-muted-foreground tabular-nums">{counts.snoozed}</span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipPopup>{entry.label}</TooltipPopup>
                </Tooltip>
              ))}
            </ToggleGroup>
          </div>
          <InboxList
            items={shown}
            tab={tab}
            loading={groups.some((group) => group.inbox === null && !group.failed)}
            failed={groups.some((group) => group.failed)}
            supported={groups.length > 0}
            onSelect={select}
          />
        </>
      )}
    </div>
  );
}

function StatusPanel() {
  const navigate = useNavigate();
  const { groups } = useMonitoringSignal();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <StatusSourcesList
        groups={groups}
        onConfigureSources={(machine) =>
          void navigate({ to: "/settings/status-sources", search: { machine } })
        }
      />
      {groups.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No connected status sources.</p>
      ) : null}
    </div>
  );
}
