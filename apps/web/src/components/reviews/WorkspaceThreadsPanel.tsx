import type { ScopedThreadRef, WorkspaceRelatedThread } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon, ArrowUpRightIcon } from "lucide-react";
import { useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
export function WorkspaceThreadsPanel({
  threadRef,
  related,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly related: ReadonlyArray<WorkspaceRelatedThread>;
}) {
  const shells = useThreadShells();
  const navigate = useNavigate();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1">
      {related.map((entry) => {
        const shell = shells.find(
          (candidate) =>
            candidate.environmentId === threadRef.environmentId && candidate.id === entry.threadId,
        );
        return (
          <button
            key={entry.threadId}
            className="flex w-full items-start gap-2 rounded border-b border-border p-2 text-left hover:bg-muted"
            onClick={() => {
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams({
                  environmentId: threadRef.environmentId,
                  threadId: entry.threadId,
                }),
              });
            }}
          >
            <MessageSquareIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {shell?.title ?? entry.threadId}
              </span>
              {entry.why ? (
                <span className="mt-1 block text-xs text-muted-foreground">{entry.why}</span>
              ) : null}
            </span>
            <ArrowUpRightIcon className="size-3.5 text-muted-foreground" />
          </button>
        );
      })}
      {!related.length ? (
        <p className="text-sm text-muted-foreground">
          Ask the agent to link related conversations here.
        </p>
      ) : null}
    </div>
  );
}
