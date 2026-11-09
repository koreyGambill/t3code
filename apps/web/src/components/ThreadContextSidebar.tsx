import { useAtomValue } from "@effect/atom-react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  AuthOrchestrationReadScope,
  type ScopedThreadRef,
  type TicketData,
  WS_METHODS,
} from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { PanelRightIcon, PinIcon, PinOffIcon, XIcon } from "lucide-react";
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
import { XwingEnvironmentsPanel } from "./xwing/XwingEnvironmentsPanel";

const sidebarWorkspaceGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "thread-context:workspace",
  tag: WS_METHODS.threadWorkspaceGet,
  staleTimeMs: 0,
  idleTtlMs: 0,
});

const sections = [
  ["marks", "Marks"],
  ["related", "Related threads"],
  ["details", "Details"],
  ["environments", "Environments"],
  ["context", "Context"],
  ["ticket", "Ticket"],
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
  const { open, pinned, expanded } = useThreadContextSidebarStore();
  const selected = selectContextThread(owner, layout, panels?.surfaces ?? [], pinned);
  const [detailsElement, setDetailsElement] = useState<HTMLDivElement | null>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "threadContext.toggle");
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
    const disposeMenu = registerMenuAction("threadContext.toggle", toggle);
    return () => {
      dispose();
      disposeMenu();
    };
  });
  const show = open && selected !== null && owner !== null;
  return (
    <ThreadDetailsDestination
      value={
        show && expanded.details && detailsElement
          ? { threadRef: selected, element: detailsElement }
          : null
      }
    >
      <div ref={commandsRef} className="flex min-h-0 min-w-0 flex-1">
        {children}
        {show ? (
          <ThreadContextSidebar
            key={`${selected.environmentId}:${selected.threadId}`}
            threadRef={selected}
            detailsRef={setDetailsElement}
          />
        ) : null}
        {owner && !show ? (
          <div className="absolute right-[var(--workspace-controls-right)] top-[var(--workspace-controls-top)] z-40 flex h-[var(--workspace-topbar-height)] items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open thread sidebar"
              title={`Thread sidebar${shortcut ? ` (${shortcut})` : ""}`}
              onClick={() => useThreadContextSidebarStore.getState().toggle()}
            >
              <PanelRightIcon />
            </Button>
          </div>
        ) : null}
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
  const { pinned, expanded } = useThreadContextSidebarStore();
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
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-background [width:min(var(--resizable-width),85vw)]"
      style={{ "--resizable-width": `${resize.width}px` } as CSSProperties}
    >
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
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{shell?.title ?? "Thread"}</p>
          <p className="text-3xs text-muted-foreground">
            {pinned ? "Pinned thread" : "Following focused tile"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={pinned ? "Unpin thread sidebar" : "Pin thread sidebar"}
          aria-pressed={pinned !== null}
          onClick={() => useThreadContextSidebarStore.getState().pin(pinned ? null : threadRef)}
        >
          {pinned ? <PinOffIcon /> : <PinIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close thread sidebar"
          onClick={() => useThreadContextSidebarStore.getState().toggle()}
        >
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sections.map(([id, title]) => (
          <details
            key={id}
            open={expanded[id] ?? false}
            className="border-b border-border/60"
            onToggle={(event) => {
              const next = event.currentTarget.open;
              if (next !== (expanded[id] ?? false))
                useThreadContextSidebarStore.getState().setExpanded(id, next);
            }}
          >
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium select-none">
              {title}
            </summary>
            {expanded[id] ? (
              <SidebarSection section={id} threadRef={threadRef} detailsRef={detailsRef} />
            ) : null}
          </details>
        ))}
      </div>
    </aside>
  );
}

function SidebarSection({
  section,
  threadRef,
  detailsRef,
}: {
  section: ThreadContextSection;
  threadRef: ScopedThreadRef;
  detailsRef: (element: HTMLDivElement | null) => void;
}) {
  switch (section) {
    case "marks":
      return <SidebarMarks threadRef={threadRef} />;
    case "related":
      return <SidebarRelated threadRef={threadRef} />;
    case "details":
      return (
        <div ref={detailsRef} className="group/details-destination">
          <div className="p-3 text-xs group-has-[[data-context-thread-details]]/details-destination:hidden">
            <SidebarThreadSummary threadRef={threadRef} />
          </div>
        </div>
      );
    case "environments":
      return <SidebarEnvironments threadRef={threadRef} />;
    case "context":
      return <ThreadContextPanel threadRef={threadRef} visible tabs={null} />;
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
  const tickets = new Map<string, TicketData | null>();
  for (const item of workspace.data?.agentWork ?? []) {
    if (item.ticket && !tickets.has(item.ticket)) tickets.set(item.ticket, item.ticketData ?? null);
  }
  if (tickets.size === 0)
    return <p className="px-3 pb-3 text-xs text-muted-foreground">No linked ticket.</p>;
  return (
    <ul className="space-y-2 px-3 pb-3 text-xs">
      {[...tickets].map(([key, data]) => (
        <li key={key} className="space-y-1">
          {data ? (
            <a href={data.url} target="_blank" rel="noreferrer" className="block hover:underline">
              <span className="font-medium">{data.key}</span> · {data.stage}
              <span className="block truncate text-muted-foreground">{data.title}</span>
            </a>
          ) : (
            <p>
              <span className="font-medium">{key}</span>{" "}
              <span className="text-muted-foreground">· unavailable</span>
            </p>
          )}
          {data?.workflow?.length ? (
            <ul className="space-y-0.5 text-muted-foreground">
              {data.workflow.map((step) => (
                <li key={step.stage}>
                  {step.done ? "✓" : "○"} {step.stage}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
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

function SidebarMarks({ threadRef }: { threadRef: ScopedThreadRef }) {
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const marks = useEnvironmentQuery(
    canRead
      ? threadMarksGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const workspace = useEnvironmentQuery(
    canRead
      ? sidebarWorkspaceGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const annotations = workspace.data?.markAnnotations ?? [];
  const rows = [
    ...annotations,
    ...(marks.data ?? []).filter(
      (mark) => !annotations.some((annotation) => annotation.url === mark.url),
    ),
  ];
  return (
    <div className="space-y-2 px-3 pb-3 text-xs">
      <Button
        variant="ghost"
        size="xs"
        disabled={!canRead}
        onClick={() => {
          marks.refresh();
          workspace.refresh();
        }}
      >
        Refresh marks
      </Button>
      {!canRead ? (
        <p className="text-muted-foreground">This connection cannot read marks.</p>
      ) : null}
      {marks.error || workspace.error ? <p role="alert">Could not load marks.</p> : null}
      {!rows.length ? (
        <p className="text-muted-foreground">
          {marks.isPending ? "Loading marks…" : "No marks in this thread."}
        </p>
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
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const workspace = useEnvironmentQuery(
    canRead
      ? sidebarWorkspaceGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const parent =
    shell?.forkedFrom?.type === "run" ? shell.forkedFrom.threadId : shell?.lineage.parentThreadId;
  const parentOf = (entry: (typeof shells)[number]) =>
    entry.forkedFrom?.type === "run" ? entry.forkedFrom.threadId : entry.lineage.parentThreadId;
  const transfers = projection?.contextTransfers ?? [];
  const replyTargets = new Set(
    projection?.messages.flatMap((message) => [
      ...(message.senderThreadId ? [message.senderThreadId] : []),
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
  const linked =
    workspace.data?.relatedThreads.filter(
      (entry) =>
        entry.threadId !== threadRef.threadId &&
        !related.some((row) => row.entry.id === entry.threadId),
    ) ?? [];
  return (
    <div className="space-y-2 px-3 pb-3 text-xs">
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
      {linked.map((entry) => (
        <SidebarRelatedLink
          key={entry.threadId}
          threadRef={{ environmentId: threadRef.environmentId, threadId: entry.threadId }}
          why={entry.why}
        />
      ))}
      {!related.length && !linked.length ? (
        <p className="text-muted-foreground">No related threads.</p>
      ) : null}
    </div>
  );
}

function SidebarRelatedLink({ threadRef, why }: { threadRef: ScopedThreadRef; why: string }) {
  const shell = useThreadShell(threadRef);
  return (
    <Link
      to="/$environmentId/$threadId"
      params={buildThreadRouteParams(threadRef)}
      className="block"
    >
      <span className="text-primary hover:underline">{shell?.title ?? threadRef.threadId}</span>
      <span className="block text-3xs text-muted-foreground">{why}</span>
    </Link>
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
