import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type ScopedThreadRef,
  type ThreadActionItem,
  type ThreadWorkspace,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { useRightPanelStore, type ThreadWorkspaceSection } from "../../rightPanelStore";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadWorkspaceGet, threadWorkspacePatch } from "../../state/threadWorkspace";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { ReviewPanel } from "./ReviewPanel";
import { useReviewSupport } from "./useReviewSupport";

const sections = [
  ["questions", "Questions"],
  ["action-items", "Action items"],
  ["design-notes", "Design notes"],
  ["summary", "Summary"],
] as const;

export function ThreadWorkspacePanel({
  threadRef,
  reviewId,
  visible,
  startedThread,
  section,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly reviewId: string | null;
  readonly visible: boolean;
  readonly startedThread: boolean;
  readonly section: ThreadWorkspaceSection;
}) {
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const supported = useReviewSupport(threadRef.environmentId);
  return (
    <div className="@container/workspace flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div
        role="tablist"
        aria-label="Workspace sections"
        className="grid grid-cols-2 gap-1 border-b border-border p-2 @min-[500px]/workspace:grid-cols-4"
      >
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            aria-controls={`workspace-${id}`}
            className="rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted aria-selected:bg-muted aria-selected:text-foreground"
            onClick={() => useRightPanelStore.getState().setWorkspaceSection(threadRef, id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`workspace-${section}`}
        aria-label={sections.find(([id]) => id === section)?.[1]}
        className="flex min-h-0 flex-1 flex-col"
      >
        {!startedThread ? (
          <p className="p-5 text-sm text-muted-foreground">
            Send the first message to start this conversation's workspace.
          </p>
        ) : !supported ? (
          <p className="p-5 text-sm text-muted-foreground">
            Workspace is unavailable on this environment. Connect to a T3 Code build with workspace
            support.
          </p>
        ) : !canRead ? (
          <p className="p-5 text-sm text-muted-foreground">
            This connection cannot read the workspace.
          </p>
        ) : section === "questions" ? (
          <ReviewPanel
            threadRef={threadRef}
            reviewId={reviewId}
            visible={visible}
            startedThread={startedThread}
          />
        ) : (
          <WorkspaceNotes
            key={`${threadRef.environmentId}:${threadRef.threadId}`}
            threadRef={threadRef}
            visible={visible}
            section={section}
          />
        )}
      </div>
    </div>
  );
}

function WorkspaceNotes({
  threadRef,
  visible,
  section,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
  readonly section: Exclude<ThreadWorkspaceSection, "questions">;
}) {
  const query = useEnvironmentQuery(
    visible
      ? threadWorkspaceGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const patch = useAtomCommand(threadWorkspacePatch, { reportFailure: false });
  const canWrite = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const [saved, setSaved] = useState<ThreadWorkspace | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspace =
    saved && (!query.data || saved.revision > query.data.revision) ? saved : query.data;
  const update = async (item: ThreadActionItem, status: ThreadActionItem["status"]) => {
    if (!workspace || pending || !canWrite) return;
    setPending(true);
    setError(null);
    const result = await patch({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        expectedRevision: workspace.revision,
        actionItems: workspace.actionItems.map((entry) =>
          entry.id === item.id ? { ...entry, status } : entry,
        ),
      },
    });
    setPending(false);
    if (result._tag === "Success") setSaved(result.value);
    else {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not update action item.");
    }
    query.refresh();
  };
  const title = sections.find(([id]) => id === section)?.[1];
  const notes = section === "design-notes" ? workspace?.designNotes : workspace?.summaryNotes;
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">
          {section === "action-items"
            ? "What the agent needs from you. Status changes save here without starting an agent run."
            : section === "design-notes"
              ? "The agent keeps decisions, tradeoffs, and design context here."
              : "The agent keeps the current state and next steps here."}
        </p>
      </div>
      {query.error || error ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{error ?? query.error}</p>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setError(null);
              query.refresh();
            }}
          >
            Refresh workspace
          </Button>
        </div>
      ) : null}
      {!workspace && query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading workspace…
        </p>
      ) : null}
      {workspace && section === "action-items" ? (
        workspace.actionItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            Nothing needs your attention here. Ask the agent to track what it needs from you as
            action items.
          </p>
        ) : (
          workspace.actionItems.map((item) => (
            <section
              key={item.id}
              aria-label={item.title}
              className="space-y-3 rounded-xl border border-border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-medium">{item.title}</h3>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.status === "open"
                    ? "Open"
                    : item.status === "deferred"
                      ? "Deferred"
                      : "Done"}
                </span>
              </div>
              {item.details ? (
                <ChatMarkdown text={item.details} cwd={undefined} threadRef={threadRef} />
              ) : null}
              <div className="flex flex-wrap gap-2">
                {item.status !== "done" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canWrite || pending}
                    onClick={() => {
                      void update(item, "done");
                    }}
                  >
                    Mark done
                  </Button>
                ) : null}
                {item.status === "open" ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!canWrite || pending}
                    onClick={() => {
                      void update(item, "deferred");
                    }}
                  >
                    Defer
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!canWrite || pending}
                    onClick={() => {
                      void update(item, "open");
                    }}
                  >
                    Reopen
                  </Button>
                )}
              </div>
            </section>
          ))
        )
      ) : workspace ? (
        notes?.trim() ? (
          <ChatMarkdown text={notes} cwd={undefined} threadRef={threadRef} />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            {section === "design-notes"
              ? "No design notes yet. Ask the agent to record its design decisions here."
              : "No summary yet. Ask the agent to keep a running summary here."}
          </p>
        )
      ) : null}
    </div>
  );
}
