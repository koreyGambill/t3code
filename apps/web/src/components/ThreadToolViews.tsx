import { Link } from "@tanstack/react-router";
import { AuthOrchestrationReadScope, type ScopedThreadRef, WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { LinkIcon, NetworkIcon, RefreshCwIcon, LightbulbIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { connectionAtomRuntime } from "../connection/runtime";
import type { ThreadInspectSection } from "../rightPanelStore";
import {
  useProject,
  useThreadProjection,
  useThreadRelationshipShells,
  useThreadShell,
} from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentScope } from "../state/session";
import { threadMarksGet } from "../state/threadMarks";
import { useXwingEnvironmentsSupport } from "../state/xwingEnvironments";
import { talkedWithThreads } from "../threadContextSidebar";
import {
  useThreadContextSidebarStore,
  type ThreadContextSection,
} from "../threadContextSidebarStore";
import { buildThreadRouteParams } from "../threadRoutes";
import { ThreadInspectPanel } from "./insights/ThreadInspectPanel";
import { ThreadListView } from "./reviews/ThreadListView";
import { ArtifactsPanel } from "./reviews/ThreadWorkspacePanel";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyMedia } from "./ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useThreadEnvironmentUsage } from "./xwing/ThreadEnvironments";
import { XwingEnvironmentsPanel } from "./xwing/XwingEnvironmentsPanel";

export const sidebarWorkspaceGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "thread-context:workspace",
  tag: WS_METHODS.threadWorkspaceGet,
  staleTimeMs: 0,
  idleTtlMs: 0,
});

/** Views that lay out their own padding and scrolling. */
export const FLUSH_THREAD_TOOLS: ReadonlySet<ThreadContextSection> = new Set(["inspect"]);

export function ThreadToolSection({
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
    case "todos":
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
    case "links":
      return <ThreadLinks threadRef={threadRef} actions={actions} />;
    case "related":
      return <ThreadRelated threadRef={threadRef} />;
    case "details":
      return (
        <div
          ref={detailsRef}
          className="@container group/details-destination mx-auto w-full max-w-4xl"
        >
          <div className="text-xs group-has-[[data-context-thread-details]]/details-destination:hidden">
            <ThreadSummary threadRef={threadRef} />
          </div>
        </div>
      );
    case "environments":
      return <ThreadEnvironments threadRef={threadRef} />;
    case "inspect":
      return <ThreadInspect threadRef={threadRef} />;
  }
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>;
}

function ThreadLinks({
  threadRef,
  actions,
}: {
  threadRef: ScopedThreadRef;
  actions: HTMLDivElement | null;
}) {
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const shell = useThreadShell(threadRef);
  const workspace = useEnvironmentQuery(
    canRead
      ? sidebarWorkspaceGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const marks = useEnvironmentQuery(
    canRead
      ? threadMarksGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const ticketStates = workspace.data?.items.flatMap((item) => item.linkStates ?? []) ?? [];
  const tickets = [
    ...new Set(
      workspace.data?.items.flatMap((item) =>
        item.links.filter((link) => link.type === "ticket").map((link) => link.target),
      ) ?? [],
    ),
  ];
  const pullRequests = shell?.pullRequests ?? [];
  const rows = marks.data ?? [];
  const empty = !tickets.length && !pullRequests.length && !rows.length;
  return (
    <div className="space-y-4 text-xs">
      {actions
        ? createPortal(
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Refresh links"
                    disabled={!canRead}
                    onClick={() => {
                      marks.refresh();
                      workspace.refresh();
                    }}
                  />
                }
              >
                <RefreshCwIcon />
              </TooltipTrigger>
              <TooltipPopup>Refresh links</TooltipPopup>
            </Tooltip>,
            actions,
          )
        : null}
      {!canRead ? (
        <p className="text-muted-foreground">This connection cannot read links.</p>
      ) : null}
      {tickets.length ? (
        <section className="space-y-2">
          <SectionHeading>Ticket</SectionHeading>
          {tickets.map((ticket) => {
            const state = ticketStates.find(
              (link) => link.type === "ticket" && link.target === ticket,
            );
            return (
              <div key={ticket} className="space-y-1 rounded-lg border border-border/60 p-2">
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
              </div>
            );
          })}
        </section>
      ) : null}
      {pullRequests.length ? (
        <section className="space-y-2">
          <SectionHeading>Pull requests</SectionHeading>
          {pullRequests.map((pullRequest) => (
            <div
              key={`${pullRequest.host}/${pullRequest.repository}#${pullRequest.number}`}
              className="space-y-1 rounded-lg border border-border/60 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <a
                  href={pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate font-medium text-primary hover:underline"
                >
                  {pullRequest.repository}#{pullRequest.number}
                </a>
                {pullRequest.snapshot ? (
                  <Badge
                    size="sm"
                    variant={
                      pullRequest.snapshot.state === "merged"
                        ? "success"
                        : pullRequest.snapshot.state === "open"
                          ? pullRequest.snapshot.isDraft
                            ? "outline"
                            : "info"
                          : "secondary"
                    }
                  >
                    {pullRequest.snapshot.isDraft && pullRequest.snapshot.state === "open"
                      ? "draft"
                      : pullRequest.snapshot.state}
                  </Badge>
                ) : null}
              </div>
              {pullRequest.snapshot ? (
                <p className="break-words leading-5 text-muted-foreground">
                  {pullRequest.snapshot.title}
                </p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {rows.length ? (
        <section className="space-y-2">
          <SectionHeading>From the conversation</SectionHeading>
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
              {mark.description ? (
                <p className="text-muted-foreground">{mark.description}</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {marks.error ? <p role="alert">Could not load links.</p> : null}
      {empty && canRead ? (
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <LinkIcon />
          </EmptyMedia>
          <EmptyDescription>
            {marks.isPending
              ? "Loading links…"
              : "The ticket, pull requests and links from the conversation appear here."}
          </EmptyDescription>
        </Empty>
      ) : null}
    </div>
  );
}

function ThreadRelated({ threadRef }: { threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(threadRef);
  const shells = useThreadRelationshipShells(threadRef);
  const projection = useThreadProjection(threadRef)?.projection;
  const messagedBy = new Set(
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
  const talkedWith = talkedWithThreads({
    threadId: threadRef.threadId,
    self: shell,
    shells,
    messagedBy,
    transfers: projection?.contextTransfers ?? [],
  });
  return (
    <div className="space-y-4 text-xs">
      <section className="space-y-2">
        <SectionHeading>Talked with</SectionHeading>
        {talkedWith.map(({ entry, relation }) => (
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
        {!talkedWith.length ? (
          <Empty size="compact">
            <EmptyMedia variant="icon">
              <NetworkIcon />
            </EmptyMedia>
            <EmptyDescription>
              Threads this one delegates to, forks or messages appear here.
            </EmptyDescription>
          </Empty>
        ) : null}
      </section>
      <section className="space-y-2">
        <SectionHeading>Suggested</SectionHeading>
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <LightbulbIcon />
          </EmptyMedia>
          <EmptyDescription>Agent-suggested related threads will appear here.</EmptyDescription>
        </Empty>
      </section>
    </div>
  );
}

function ThreadSummary({ threadRef }: { threadRef: ScopedThreadRef }) {
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

function ThreadEnvironments({ threadRef }: { threadRef: ScopedThreadRef }) {
  const selection = useThreadContextSidebarStore((state) => state.environmentSelection);
  const selectedId =
    selection?.thread.environmentId === threadRef.environmentId &&
    selection.thread.threadId === threadRef.threadId
      ? selection.id
      : undefined;
  const supported = useXwingEnvironmentsSupport(threadRef.environmentId);
  const usage = useThreadEnvironmentUsage(threadRef, true);
  const shell = useThreadShell(threadRef);
  const [browseXwing, setBrowseXwing] = useState(false);
  const attached =
    shell?.developmentEnvironment != null ||
    usage.environments.length > 0 ||
    usage.missing.length > 0;
  if (supported && (attached || browseXwing || selectedId !== undefined)) {
    return (
      <XwingEnvironmentsPanel
        threadRef={threadRef}
        selectedId={selectedId}
        visible
        onSelect={(id) => useThreadContextSidebarStore.getState().selectEnvironment(threadRef, id)}
      />
    );
  }
  return (
    <div className="space-y-4 text-xs">
      <ThreadWorkspaceSummary threadRef={threadRef} />
      {supported && !usage.usage.isPending ? (
        <section className="space-y-2">
          <SectionHeading>Xwing</SectionHeading>
          <p className="text-muted-foreground">No Xwing environment is attached to this thread.</p>
          <Button variant="outline" size="sm" onClick={() => setBrowseXwing(true)}>
            Browse Xwing
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function ThreadWorkspaceSummary({ threadRef }: { threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(threadRef);
  const project = useProject(
    shell ? { environmentId: threadRef.environmentId, projectId: shell.projectId } : null,
  );
  const path = shell?.worktreePath ?? project?.workspaceRoot ?? null;
  return (
    <section className="space-y-2">
      <SectionHeading>Workspace</SectionHeading>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">{shell?.worktreePath ? "Worktree" : "Folder"}</dt>
        <dd className="min-w-0 break-all font-mono text-3xs leading-4">{path ?? "Unavailable"}</dd>
        <dt className="text-muted-foreground">Branch</dt>
        <dd className="min-w-0 break-all font-mono text-3xs leading-4">
          {shell?.branch ?? "None"}
        </dd>
      </dl>
    </section>
  );
}

function ThreadInspect({ threadRef }: { threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(threadRef);
  const [section, setSection] = useState<ThreadInspectSection>("loads");
  return (
    <ThreadInspectPanel
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
      section={section}
      onSectionChange={setSection}
      visible
      startedThread={shell !== null}
    />
  );
}
