import type { ScopedThreadRef } from "@t3tools/contracts";
import { useRightPanelStore, type ThreadInspectSection } from "../../rightPanelStore";
import { ThreadInsightsPanel } from "./ThreadInsightsPanel";

const sections = [
  ["loads", "Loads"],
  ["tokens", "Tokens"],
] as const;

export function ThreadInspectPanel({
  threadRef,
  section,
  visible,
  startedThread,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly section: ThreadInspectSection;
  readonly visible: boolean;
  readonly startedThread: boolean;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div
        role="tablist"
        aria-label="Inspect sections"
        className="flex shrink-0 gap-1 border-b border-border p-2"
      >
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className="rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted aria-selected:bg-muted aria-selected:text-foreground"
            onClick={() => useRightPanelStore.getState().setInspectSection(threadRef, id)}
          >
            {label}
          </button>
        ))}
      </div>
      {startedThread ? (
        <ThreadInsightsPanel threadRef={threadRef} visible={visible} mode={section} />
      ) : (
        <p className="p-5 text-sm text-muted-foreground">
          Send the first message to inspect this conversation's activity.
        </p>
      )}
    </div>
  );
}
