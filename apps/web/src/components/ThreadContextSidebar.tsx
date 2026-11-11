import { useAtomValue } from "@effect/atom-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AuthOrchestrationReadScope, type ScopedThreadRef, WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import {
  PanelRightIcon,
  PinIcon,
  PinOffIcon,
  XIcon,
  ListChecksIcon,
  FilesIcon,
  BookmarkIcon,
  NetworkIcon,
  InfoIcon,
  BoxesIcon,
  BrainIcon,
  TicketIcon,
  Maximize2Icon,
  Minimize2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Empty, EmptyMedia, EmptyDescription } from "./ui/empty";
import { useState, type CSSProperties, type ReactNode } from "react";
import { connectionAtomRuntime } from "../connection/runtime";
import { useResizableWidth } from "../hooks/useResizableWidth";
import { shortcutLabelForCommand } from "../keybindings";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { selectThreadTileLayout, useRightPanelStore } from "../rightPanelStore";
import { registerCommands, registerMenuAction } from "../shortcuts/dispatcher";
import {
  useThreadProjection,
  useThreadShell,
  useThreadRelationshipShells,
} from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { threadMarksGet } from "../state/threadMarks";
import { selectContextThread } from "../threadContextSidebar";
import {
  useThreadContextSidebarStore,
  type ThreadContextSection,
} from "../threadContextSidebarStore";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { ThreadDetailsDestination } from "./chat/ThreadDetailsDestination";
import { ThreadContextPanel } from "./insights/ThreadContextPanel";
import { RightPanelResizeHandle } from "./preview/RightPanelResizeHandle";
import { Button } from "./ui/button";
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

const sections = [
  ["list", "List", ListChecksIcon],
  ["artifacts", "Artifacts", FilesIcon],
  ["marks", "Marks", BookmarkIcon],
  ["related", "Related threads", NetworkIcon],
  ["details", "Details", InfoIcon],
  ["environments", "Environments", BoxesIcon],
  ["context", "Context", BrainIcon],
  ["ticket", "Ticket", TicketIcon],
] as const;

export function ThreadContextSidebarHost({ children }: { children: ReactNode }) {
  const owner = useRouterState({
    select: (state) => resolveThreadRouteRef(state.matches.at(-1)?.params ?? {}),
  });
  const panels = useRightPanelStore((state) =>
    owner ? state.byThreadKey[`${owner.environmentId}:${owner.threadId}`] : undefined,
  );
  const layout = useRightPanelStore((state) =>
    owner ? selectThreadTileLayout(state.byThreadKey, owner) : null,
  );
  const { open, pinned, view } = useThreadContextSidebarStore();
  const selected = selectContextThread(owner, layout, panels?.surfaces ?? [], pinned);
  const [detailsElement, setDetailsElement] = useState<HTMLDivElement | null>(null);
  const [commandsRef] = useState(() => (node: HTMLDivElement | null) => {
    if (!node) return;
    const toggle = () => useThreadContextSidebarStore.getState().toggle();
    const dispose = registerCommands(
      {
        "threadContext.toggle": (event) => {
          event.preventDefault();
          toggle();
        },
      },
      {
        capture: true,
        when: (event) =>
          !(event.target instanceof Element && event.target.closest("[data-keybinding-capture]")),
      },
    );
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        useThreadContextSidebarStore.getState().maximized &&
        !document.querySelector(
          '[data-slot="menu-popup"], [data-slot="select-popup"], [role="dialog"]',
        )
      ) {
        useThreadContextSidebarStore.getState().restore();
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", escape, true);
    const disposeMenu = registerMenuAction("threadContext.toggle", toggle);
    return () => {
      window.removeEventListener("keydown", escape, true);
      dispose();
      disposeMenu();
    };
  });
  const show = open && selected !== null && owner !== null;
  return (
    <ThreadDetailsDestination
      value={
        show && view === "details" && detailsElement
          ? { threadRef: selected, element: detailsElement }
          : null
      }
    >
      <div ref={commandsRef} className="relative flex min-h-0 min-w-0 flex-1">
        {children}
        {selected && owner ? (
          <ThreadContextSidebar
            key={`${selected.environmentId}:${selected.threadId}`}
            threadRef={selected}
            detailsRef={setDetailsElement}
          />
        ) : (
          <nav
            aria-label="Status"
            className="flex w-11 shrink-0 flex-col items-center gap-2 border-l border-border bg-muted/20 pb-2 [-webkit-app-region:no-drag]"
          >
            <div className="h-[var(--workspace-topbar-height)] shrink-0" />
            <MonitoringStatusButton />
          </nav>
        )}
      </div>
    </ThreadDetailsDestination>
  );
}

function ThreadContextSidebar({
  threadRef,
  detailsRef,
}: {
  threadRef: ScopedThreadRef;
  detailsRef: (element: HTMLDivElement | null) => void;
}) {
  const shell = useThreadShell(threadRef);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "threadContext.toggle") ?? "Mod+Alt+I";
  const { open, pinned, view, maximized } = useThreadContextSidebarStore();
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const workspace = useEnvironmentQuery(
    canRead
      ? sidebarWorkspaceGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const listCount = workspace.data?.items.filter((item) => item.state === "open").length ?? 0;
  const ticketState = workspace.data?.items
    .flatMap((item) => item.linkStates ?? [])
    .find((link) => link.type === "ticket");
  const questionCount =
    workspace.data?.artifacts.reduce((total, artifact) => {
      const version = artifact.versions.at(-1);
      return (
        total +
        (version?.questions.filter((question) => !version.answers[question.id]?.submittedAt)
          .length ?? 0)
      );
    }, 0) ?? 0;
  const resize = useResizableWidth({
    storageKey: "t3code:thread-context-width",
    defaultWidth: 340,
    minWidth: 260,
    maxWidth: 640,
    edge: "left",
  });
  return (
    <aside
      {...workspaceAreaProps("details", 3, "Thread sidebar")}
      aria-label="Thread sidebar"
      data-context-thread-id={threadRef.threadId}
      className={
        maximized && open
          ? "absolute inset-0 z-40 flex min-h-0 border-l border-border bg-background"
          : "relative flex h-full min-h-0 shrink-0 border-l border-border bg-background"
      }
      style={{ "--resizable-width": `${resize.width}px` } as CSSProperties}
    >
      {open ? (
        <div
          className={
            maximized
              ? "flex min-h-0 min-w-0 flex-1 flex-col"
              : "flex min-h-0 min-w-0 flex-col [width:min(var(--resizable-width),75vw)]"
          }
        >
          <div className="h-[var(--native-titlebar-height)] shrink-0" />
          {!maximized ? (
            <RightPanelResizeHandle
              handlers={resize.handlers}
              label="Thread sidebar width"
              tabIndex={0}
              aria-valuenow={resize.width}
              aria-valuemin={260}
              aria-valuemax={640}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  resize.setWidth(resize.width + (event.key === "ArrowLeft" ? 20 : -20));
                }
              }}
            />
          ) : null}
          <header className="flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 border-b border-border px-2 [-webkit-app-region:no-drag]">
            <div className="min-w-0 flex-1">
              <Tooltip>
                <TooltipTrigger render={<p className="truncate text-sm font-medium" />}>
                  {sections.find(([id]) => id === view)?.[1]}
                </TooltipTrigger>
                <TooltipPopup>{shell?.title ?? "Thread"}</TooltipPopup>
              </Tooltip>
            </div>
            <div ref={setActions} className="flex items-center" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={maximized ? "Restore thread sidebar" : "Maximize thread sidebar"}
                    onClick={() => useThreadContextSidebarStore.getState().toggleMaximized()}
                  />
                }
              >
                {maximized ? <Minimize2Icon /> : <Maximize2Icon />}
              </TooltipTrigger>
              <TooltipPopup>{maximized ? "Restore · Escape" : "Maximize"}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={pinned ? "Unpin thread sidebar" : "Pin thread sidebar"}
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close thread sidebar"
                    aria-expanded
                    onClick={() => useThreadContextSidebarStore.getState().toggle()}
                  />
                }
              >
                <XIcon />
              </TooltipTrigger>
              <TooltipPopup>Close thread sidebar · {shortcut}</TooltipPopup>
            </Tooltip>
          </header>
          <div
            className="flex min-h-0 flex-1 flex-col overflow-auto scrollbar-gutter-both px-3 py-3"
            key={`${threadRef.threadId}:${view}`}
          >
            <SidebarSection
              section={view}
              threadRef={threadRef}
              detailsRef={detailsRef}
              actions={actions}
            />
          </div>
        </div>
      ) : null}
      <nav
        aria-label="Thread sidebar views"
        className="flex w-11 shrink-0 flex-col items-center gap-2 border-l border-border bg-muted/20 pb-2 [-webkit-app-region:no-drag]"
      >
        <div className="h-[var(--workspace-topbar-height)] shrink-0" />
        <MonitoringStatusButton />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={open ? "Close thread sidebar" : "Open thread sidebar"}
                aria-expanded={open}
                onClick={() => useThreadContextSidebarStore.getState().toggle()}
              />
            }
          >
            <PanelRightIcon />
          </TooltipTrigger>
          <TooltipPopup>
            {open ? "Close" : "Open"} thread sidebar · {shortcut}
          </TooltipPopup>
        </Tooltip>
        {sections.map(([id, title, Icon]) => {
          const count = id === "list" ? listCount : id === "artifacts" ? questionCount : 0;
          return (
            <div key={id} className="relative">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant={open && view === id ? "secondary" : "ghost"}
                      size="icon-sm"
                      aria-label={title}
                      aria-pressed={open && view === id}
                      onClick={() => useThreadContextSidebarStore.getState().selectView(id)}
                    />
                  }
                >
                  <Icon />
                </TooltipTrigger>
                <TooltipPopup>{open && view === id ? "Hide panel" : title}</TooltipPopup>
              </Tooltip>
              {id === "ticket" && ticketState ? (
                <span
                  className={`pointer-events-none absolute right-0 top-0 size-1.5 rounded-full ring-2 ring-background ${ticketState.state === "closed" ? "bg-success" : "bg-info"}`}
                />
              ) : null}
              {count ? (
                <span className="pointer-events-none absolute -right-2.5 -top-2 rounded-full bg-muted ring-1 ring-background">
                  <Badge size="sm" variant="secondary">
                    {count}
                  </Badge>
                </span>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
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
