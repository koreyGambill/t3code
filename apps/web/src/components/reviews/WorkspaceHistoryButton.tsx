import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Clock3Icon } from "lucide-react";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Popover, PopoverTrigger, PopoverPopup } from "../ui/popover";
import { useWorkspaceNavigation } from "./workspaceNavigation";

export function WorkspaceHistoryButton({
  threadRef,
  title,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
}) {
  const navigate = useNavigate();
  const state = useWorkspaceNavigation();
  const { environmentId, threadId } = threadRef;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Records route visits from every entry point in the browser-style navigation stack.
  useEffect(() => {
    useWorkspaceNavigation.getState().visit({ ref: { environmentId, threadId }, title });
  }, [environmentId, threadId, title]);
  const open = (ref: ScopedThreadRef) => {
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  return (
    <div className="flex shrink-0 items-center [-webkit-app-region:no-drag]">
      <Popover>
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
            {state.recent.map((visit) => (
              <button
                key={`${visit.ref.environmentId}:${visit.ref.threadId}`}
                className="block h-8 w-full truncate rounded px-2 text-left text-xs hover:bg-muted"
                onClick={() => open(visit.ref)}
              >
                {visit.title}
              </button>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
