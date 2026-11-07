import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Clock3Icon } from "lucide-react";
import { useQuietThreadShell } from "../../state/entities";
import { ThreadGlyph } from "../ThreadGlyph";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Popover, PopoverTrigger, PopoverPopup } from "../ui/popover";
import { useWorkspaceNavigation } from "./workspaceNavigation";

export function useWorkspaceVisit(threadRef: ScopedThreadRef | null, title: string) {
  const environmentId = threadRef?.environmentId;
  const threadId = threadRef?.threadId;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records route visits from every entry point in recent thread history
  useEffect(() => {
    if (environmentId && threadId)
      useWorkspaceNavigation.getState().visit({ ref: { environmentId, threadId }, title });
  }, [environmentId, threadId, title]);
}

export function WorkspaceHistoryButton() {
  const navigate = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false);
  const recent = useWorkspaceNavigation((state) => state.recent);
  const open = (ref: ScopedThreadRef) => {
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  return (
    <div className="flex shrink-0 items-center [-webkit-app-region:no-drag]">
      <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
        <PopoverTrigger
          render={
            <Button size="icon-sm" variant="ghost-muted" aria-label="Recent Threads">
              <Clock3Icon className="size-4" />
            </Button>
          }
        />
        <PopoverPopup side="bottom" align="end" className="w-72">
          <h2 className="px-2 py-2 text-xs font-medium">Recent Threads</h2>
          <div className="max-h-80 overflow-y-auto">
            {recent.map((visit) => (
              <button
                key={`${visit.ref.environmentId}:${visit.ref.threadId}`}
                className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-muted"
                onClick={() => {
                  setHistoryOpen(false);
                  open(visit.ref);
                }}
              >
                <HistoryThreadGlyph threadRef={visit.ref} />
                <span className="min-w-0 truncate">{visit.title}</span>
              </button>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}

function HistoryThreadGlyph({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const thread = useQuietThreadShell(threadRef);
  return <ThreadGlyph threadId={threadRef.threadId} seed={thread?.glyphSeed} className="size-4" />;
}
