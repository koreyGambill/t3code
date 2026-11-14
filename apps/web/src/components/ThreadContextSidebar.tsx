import { useAtomValue } from "@effect/atom-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AuthOrchestrationReadScope, type ScopedThreadRef, WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import {
  PinIcon,
  PinOffIcon,
  ListChecksIcon,
  FilesIcon,
  BookmarkIcon,
  NetworkIcon,
  InfoIcon,
  BoxesIcon,
  BrainIcon,
  TicketIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Empty, EmptyMedia, EmptyDescription } from "./ui/empty";
import { useEffect, useState, type ReactNode } from "react";
import { connectionAtomRuntime } from "../connection/runtime";
import { shortcutLabelForCommand } from "../keybindings";
import { cn } from "../lib/utils";
import { selectThreadTileLayout, useRightPanelStore } from "../rightPanelStore";
import { registerCommands } from "../shortcuts/dispatcher";
import {
  useThreadProjection,
  useThreadShell,
  useThreadRelationshipShells,
} from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { threadMarksGet } from "../state/threadMarks";
import { selectContextThread, summarizeThreadTools } from "../threadContextSidebar";
import {
  useThreadContextSidebarStore,
  type SidebarView,
  type ThreadContextSection,
} from "../threadContextSidebarStore";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { ThreadDetailsDestination } from "./chat/ThreadDetailsDestination";
import { ThreadContextPanel } from "./insights/ThreadContextPanel";
import { Button } from "./ui/button";
import { useSidebar, useSidebarVisibility } from "./ui/sidebar";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import { ThreadListView } from "./reviews/ThreadListView";
import { ArtifactsPanel } from "./reviews/ThreadWorkspacePanel";
import { Badge } from "./ui/badge";
import { MonitoringStatusButton } from "./monitoring/MonitoringStatusButton";
import { XwingEnvironmentsPanel } from "./xwing/XwingEnvironmentsPanel";

const sidebarWorkspaceGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "thread-context:workspace",
  tag: WS_METHODS.threadWorkspaceGet,
  staleTimeMs: 0,
  idleTtlMs: 0,
});

const sections: ReadonlyArray<readonly [ThreadContextSection, string, LucideIcon]> = [
  ["list", "List", ListChecksIcon],
  ["artifacts", "Artifacts", FilesIcon],
  ["marks", "Marks", BookmarkIcon],
  ["related", "Related threads", NetworkIcon],
  ["details", "Details", InfoIcon],
  ["environments", "Environments", BoxesIcon],
  ["context", "Context", BrainIcon],
  ["ticket", "Ticket", TicketIcon],
];

function useThreadToolsTarget(): ScopedThreadRef | null {
  const owner = useRouterState({
    select: (state) => resolveThreadRouteRef(state.matches.at(-1)?.params ?? {}),
  });
  const surfaces = useRightPanelStore((state) =>
    owner ? state.byThreadKey[`${owner.environmentId}:${owner.threadId}`]?.surfaces : undefined,
  );
  const layout = useRightPanelStore((state) =>
    owner ? selectThreadTileLayout(state.byThreadKey, owner) : null,
  );
  const pinned = useThreadContextSidebarStore((state) => state.pinned);
  return selectContextThread(owner, layout, surfaces ?? [], pinned);
}

const setDetailsElement = (detailsElement: HTMLDivElement | null) =>
  useThreadContextSidebarStore.setState({ detailsElement });

/** Lets the conversation move its details card into the sidebar's Details view. */
export function ThreadToolsDetailsHost({ children }: { children: ReactNode }) {
  const threadRef = useThreadToolsTarget();
  const view = useThreadContextSidebarStore((state) => state.view);
  const element = useThreadContextSidebarStore((state) => state.detailsElement);
  return (
    <ThreadDetailsDestination
      value={view === "details" && threadRef && element ? { threadRef, element } : null}
    >
      {children}
    </ThreadDetailsDestination>
  );
}

/** The activity strip beside the left sidebar's content, swapping the thread list for a tool view. */
export function ThreadToolsFrame({ children }: { children: ReactNode }) {
  const threadRef = useThreadToolsTarget();
  const view = useThreadContextSidebarStore((state) => state.view);
  const visible = useSidebarVisibility();
  return (
    <div className="flex min-h-0 flex-1">
      <ThreadToolsStrip threadRef={threadRef} />
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", view !== "threads" && "hidden")}>
        {children}
      </div>
      {view !== "threads" && visible ? (
        <ThreadToolView
          key={threadRef ? `${threadRef.environmentId}:${threadRef.threadId}:${view}` : view}
          view={view}
          threadRef={threadRef}
          detailsRef={setDetailsElement}
        />
      ) : null}
      <ThreadToolsCommands />
    </div>
  );
}

function ThreadToolsCommands() {
  const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar();
  const visible = isMobile ? openMobile : open;
  const revealPending = useThreadContextSidebarStore((state) => state.revealPending);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The shortcut needs the sidebar's current visibility to decide between opening and flipping views.
  useEffect(
    () =>
      registerCommands(
        {
          "threadContext.toggle": (event) => {
            event.preventDefault();
            useThreadContextSidebarStore.getState().toggleTools(visible);
          },
        },
        {
          capture: true,
          when: (event) =>
            !(event.target instanceof Element && event.target.closest("[data-keybinding-capture]")),
        },
      ),
    [visible],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Tool requests from outside the sidebar (palette, list summary, shortcut) open the sidebar's own store.
  useEffect(() => {
    if (!revealPending) return;
    useThreadContextSidebarStore.getState().consumeReveal();
    if (isMobile) setOpenMobile(true);
    else setOpen(true);
  }, [revealPending, isMobile, setOpen, setOpenMobile]);
  return null;
}

function useThreadToolSignals(threadRef: ScopedThreadRef | null) {
  const canRead = useEnvironmentScope(threadRef?.environmentId ?? null, AuthOrchestrationReadScope);
  const workspace = useEnvironmentQuery(
    threadRef && canRead
      ? sidebarWorkspaceGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  return summarizeThreadTools(workspace.data ?? null);
}

function ThreadToolsStrip({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "threadContext.toggle");
  const view = useThreadContextSidebarStore((state) => state.view);
  const lastTool = useThreadContextSidebarStore((state) => state.lastTool);
  const signals = useThreadToolSignals(threadRef);
  // The shortcut flips to whichever view this names, so its tooltip carries the label.
  const shortcutTarget: SidebarView = view === "threads" ? lastTool : "threads";
  const tooltip = (id: SidebarView, title: string) =>
    `${view === id && id !== "threads" ? "Back to thread list" : title}${
      shortcut && shortcutTarget === id ? ` · ${shortcut}` : ""
    }`;
  return (
    <nav
      aria-label="Sidebar views"
      className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-sidebar-border py-2 [-webkit-app-region:no-drag] [scrollbar-width:none]"
    >
      <MonitoringStatusButton />
      <span aria-hidden className="my-0.5 h-px w-5 shrink-0 bg-sidebar-border" />
      <StripButton
        id="threads"
        title="Thread list"
        icon={MessagesSquareIcon}
        active={view === "threads"}
        tooltip={tooltip("threads", "Thread list")}
      />
      {sections.map(([id, title, Icon]) => {
        const count =
          id === "list" ? signals.listCount : id === "artifacts" ? signals.questionCount : 0;
        return (
          <StripButton
            key={id}
            id={id}
            title={title}
            icon={Icon}
            active={view === id}
            tooltip={tooltip(id, title)}
            {...(count
              ? { badge: `${count} ${id === "list" ? "open" : "unanswered"}` }
              : id === "ticket" && signals.ticketState
                ? { badge: `ticket ${signals.ticketState.replace("_", " ")}` }
                : {})}
          >
            {id === "ticket" && signals.ticketState ? (
              <span
                className={cn(
                  "pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full ring-2 ring-sidebar",
                  signals.ticketState === "closed" ? "bg-success" : "bg-info",
                )}
              />
            ) : null}
            {count ? (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -right-1 -top-1 min-w-3.5 rounded-full px-1 text-center text-3xs leading-3.5 font-medium ring-2 ring-sidebar",
                  id === "artifacts"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted-foreground text-sidebar",
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </StripButton>
        );
      })}
    </nav>
  );
}

function StripButton(props: {
  id: SidebarView;
  title: string;
  icon: LucideIcon;
  active: boolean;
  tooltip: string;
  badge?: string;
  children?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div className="relative">
      {props.active ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 -left-2 w-0.5 rounded-full bg-primary"
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={props.active ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={`${props.title}${props.badge ? `, ${props.badge}` : ""}`}
              aria-pressed={props.active}
              onClick={() => useThreadContextSidebarStore.getState().selectView(props.id)}
            />
          }
        >
          <Icon />
        </TooltipTrigger>
        <TooltipPopup side="right">{props.tooltip}</TooltipPopup>
      </Tooltip>
      {props.children}
    </div>
  );
}

function ThreadToolView({
  view,
  threadRef,
  detailsRef,
}: {
  view: ThreadContextSection;
  threadRef: ScopedThreadRef | null;
  detailsRef: (element: HTMLDivElement | null) => void;
}) {
  const shell = useThreadShell(threadRef);
  const pinned = useThreadContextSidebarStore((state) => state.pinned);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const title = sections.find(([id]) => id === view)?.[1] ?? "";
  return (
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-sidebar-border pl-3 pr-1.5">
        <p className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
          <span className="shrink-0 font-medium">{title}</span>
          {shell ? (
            <span className="truncate text-xs text-muted-foreground">{shell.title}</span>
          ) : null}
        </p>
        <div ref={setActions} className="flex items-center" />
        {threadRef ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={pinned ? "Unpin thread tools" : "Pin thread tools"}
                  aria-pressed={pinned !== null}
                  onClick={() =>
                    useThreadContextSidebarStore.getState().pin(pinned ? null : threadRef)
                  }
                />
              }
            >
              {pinned ? <PinOffIcon /> : <PinIcon />}
            </TooltipTrigger>
            <TooltipPopup>{pinned ? "Follow focused tile" : "Pin this thread"}</TooltipPopup>
          </Tooltip>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2.5 py-2.5">
        {threadRef ? (
          <SidebarSection
            section={view}
            threadRef={threadRef}
            detailsRef={detailsRef}
            actions={actions}
          />
        ) : (
          <Empty size="compact">
            <EmptyDescription>Open a thread to see its {title.toLowerCase()}.</EmptyDescription>
          </Empty>
        )}
      </div>
    </section>
  );
}

function SidebarSection({
  section,
  threadRef,
  detailsRef,
  actions,
}: {
  section: ThreadContextSection;
  threadRef: ScopedThreadRef;
  detailsRef: (element: HTMLDivElement | null) => void;
  actions: HTMLDivElement | null;
}) {
  switch (section) {
    case "list":
      return (
        <ThreadListView
          key={`${threadRef.environmentId}:${threadRef.threadId}`}
          threadRef={threadRef}
        />
      );
    case "artifacts":
      return (
        <ArtifactsPanel
          inSidebar
          threadRef={threadRef}
          selectedId={null}
          workspaceMutationId={null}
          composerDraftTarget={threadRef}
        />
      );
    case "marks":
      return <SidebarMarks threadRef={threadRef} actions={actions} />;
    case "related":
      return <SidebarRelated threadRef={threadRef} />;
    case "details":
      return (
        <div
          ref={detailsRef}
          className="@container group/details-destination mx-auto w-full max-w-4xl"
        >
          <div className="text-xs group-has-[[data-context-thread-details]]/details-destination:hidden">
            <SidebarThreadSummary threadRef={threadRef} />
          </div>
        </div>
      );
    case "environments":
      return <SidebarEnvironments threadRef={threadRef} />;
    case "context":
      return (
        <ThreadContextPanel threadRef={threadRef} visible tabs={null} headerActions={actions} />
      );
    case "ticket":
      return <SidebarTickets threadRef={threadRef} />;
  }
}

function SidebarTickets({ threadRef }: { threadRef: ScopedThreadRef }) {
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const workspace = useEnvironmentQuery(
    canRead
      ? sidebarWorkspaceGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const tickets = [
    ...new Set(
      workspace.data?.items.flatMap((item) =>
        item.links.filter((link) => link.type === "ticket").map((link) => link.target),
      ) ?? [],
    ),
  ];
  return tickets.length ? (
    <ul className="space-y-2 text-xs">
      {tickets.map((ticket) => {
        const state = workspace.data?.items
          .flatMap((item) => item.linkStates ?? [])
          .find((link) => link.type === "ticket" && link.target === ticket);
        return (
          <li key={ticket} className="space-y-1 rounded-lg border border-border/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <a
                href={state?.url ?? ticket}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                {ticket}
              </a>
              <Badge
                size="sm"
                variant={
                  state?.state === "closed"
                    ? "success"
                    : state?.state === "open"
                      ? "info"
                      : "outline"
                }
              >
                {state?.label ?? "Unavailable"}
              </Badge>
            </div>
            <p className="break-words leading-5 text-muted-foreground">
              {state?.title ?? "Ticket details unavailable"}
            </p>
          </li>
        );
      })}
    </ul>
  ) : (
    <Empty size="compact">
      <EmptyMedia variant="icon">
        <TicketIcon />
      </EmptyMedia>
      <EmptyDescription>Tickets linked from List items appear here.</EmptyDescription>
    </Empty>
  );
}

function SidebarEnvironments({ threadRef }: { threadRef: ScopedThreadRef }) {
  const selection = useThreadContextSidebarStore((state) => state.environmentSelection);
  const selectedId =
    selection?.thread.environmentId === threadRef.environmentId &&
    selection.thread.threadId === threadRef.threadId
      ? selection.id
      : undefined;
  return (
    <XwingEnvironmentsPanel
      threadRef={threadRef}
      selectedId={selectedId}
      visible
      onSelect={(id) => useThreadContextSidebarStore.getState().selectEnvironment(threadRef, id)}
    />
  );
}

function SidebarMarks({
  threadRef,
  actions,
}: {
  threadRef: ScopedThreadRef;
  actions: HTMLDivElement | null;
}) {
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const marks = useEnvironmentQuery(
    canRead
      ? threadMarksGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const rows = marks.data ?? [];
  return (
    <div className="space-y-2 text-xs">
      {actions
        ? createPortal(
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Refresh marks"
                    disabled={!canRead}
                    onClick={() => marks.refresh()}
                  />
                }
              >
                <RefreshCwIcon />
              </TooltipTrigger>
              <TooltipPopup>Refresh marks</TooltipPopup>
            </Tooltip>,
            actions,
          )
        : null}
      {!canRead ? (
        <p className="text-muted-foreground">This connection cannot read marks.</p>
      ) : null}
      {marks.error ? <p role="alert">Could not load marks.</p> : null}
      {!rows.length ? (
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <BookmarkIcon />
          </EmptyMedia>
          <EmptyDescription>
            {marks.isPending ? "Loading marks…" : "Saved thread marks appear here."}
          </EmptyDescription>
        </Empty>
      ) : null}
      {rows.map((mark) => (
        <div key={mark.url} className="min-w-0 break-words">
          {"contextSource" in mark && mark.contextSource ? (
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams({
                environmentId: threadRef.environmentId,
                threadId: mark.contextSource.threadId,
              })}
              className="text-primary hover:underline"
            >
              {mark.name ?? mark.url}
            </Link>
          ) : mark.url.startsWith("xwing-environment:") ? (
            <Button
              variant="link"
              size="xs"
              onClick={() =>
                useThreadContextSidebarStore
                  .getState()
                  .openEnvironments(threadRef, mark.url.slice("xwing-environment:".length))
              }
            >
              {mark.url}
            </Button>
          ) : (
            <a
              href={mark.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              {"name" in mark ? (mark.name ?? mark.url) : mark.url}
            </a>
          )}
          {mark.description ? <p className="text-muted-foreground">{mark.description}</p> : null}
        </div>
      ))}
    </div>
  );
}

function SidebarRelated({ threadRef }: { threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(threadRef);
  const shells = useThreadRelationshipShells(threadRef);
  const projection = useThreadProjection(threadRef)?.projection;
  const parent =
    shell?.forkedFrom?.type === "run" ? shell.forkedFrom.threadId : shell?.lineage.parentThreadId;
  const parentOf = (entry: (typeof shells)[number]) =>
    entry.forkedFrom?.type === "run" ? entry.forkedFrom.threadId : entry.lineage.parentThreadId;
  const transfers = projection?.contextTransfers ?? [];
  const replyTargets = new Set(
    projection?.messages.flatMap((message) => [
      ...(message.origin &&
      "threadId" in message.origin &&
      message.origin.environmentId === threadRef.environmentId
        ? [message.origin.threadId]
        : []),
      ...(message.notification?.source.kind === "thread_reply" &&
      (message.notification.source.environmentId === undefined ||
        message.notification.source.environmentId === threadRef.environmentId)
        ? [message.notification.source.threadId]
        : []),
    ]),
  );
  const related = shells
    .filter((entry) => entry.id !== threadRef.threadId)
    .flatMap((entry) => {
      const relation =
        entry.id === parent
          ? "Parent"
          : parentOf(entry) === threadRef.threadId
            ? "Child"
            : parent && parentOf(entry) === parent
              ? "Sibling"
              : replyTargets.has(entry.id)
                ? "Reply target"
                : transfers.some(
                      (transfer) =>
                        transfer.sourceThreadId === entry.id ||
                        transfer.targetThreadId === entry.id,
                    )
                  ? "Context / reply target"
                  : null;
      return relation ? [{ entry, relation }] : [];
    });
  return (
    <div className="space-y-2 text-xs">
      {related.map(({ entry, relation }) => (
        <Link
          key={entry.id}
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams({
            environmentId: threadRef.environmentId,
            threadId: entry.id,
          })}
          className="block"
        >
          <span className="block text-3xs text-muted-foreground">{relation}</span>
          <span className="text-primary hover:underline">{entry.title}</span>
        </Link>
      ))}
      {!related.length ? (
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <NetworkIcon />
          </EmptyMedia>
          <EmptyDescription>Forked threads and reply targets appear here.</EmptyDescription>
        </Empty>
      ) : null}
    </div>
  );
}

function SidebarThreadSummary({ threadRef }: { threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(threadRef);
  return (
    <div className="space-y-2 break-words">
      <p>{shell?.title ?? "Thread unavailable"}</p>
      <p className="text-muted-foreground">{shell?.worktreePath}</p>
      <p>{shell?.branch}</p>
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(threadRef)}
        className="text-primary hover:underline"
      >
        Open conversation details
      </Link>
    </div>
  );
}
