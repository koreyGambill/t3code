import { ThreadContextPanel } from "./ThreadContextPanel";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ThreadInsightsPanel } from "./ThreadInsightsPanel";

export type ThreadInspectSection = "loads" | "tokens" | "context";

const sections = [
  ["loads", "Loads"],
  ["context", "Context"],
  ["tokens", "Tokens"],
] as const;

export function ThreadInspectPanel({
  threadRef,
  section,
  visible,
  startedThread,
  onSectionChange,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly section: ThreadInspectSection;
  readonly visible: boolean;
  readonly startedThread: boolean;
  readonly onSectionChange: (section: ThreadInspectSection) => void;
}) {
  const tabs = (
    <div role="tablist" aria-label="Inspect sections" className="flex shrink-0 gap-0.5">
      {sections.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={section === id}
          className="shrink-0 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted aria-selected:bg-muted aria-selected:text-foreground"
          onClick={() => onSectionChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {startedThread ? (
        section === "context" ? (
          <ThreadContextPanel
            key={`${threadRef.environmentId}:${threadRef.threadId}`}
            threadRef={threadRef}
            visible={visible}
            tabs={tabs}
          />
        ) : (
          <ThreadInsightsPanel threadRef={threadRef} visible={visible} mode={section} tabs={tabs} />
        )
      ) : (
        <>
          <div className="flex h-7 shrink-0 items-center border-b border-border px-1">{tabs}</div>
          <p className="p-2 text-xs text-muted-foreground">Send a message to inspect activity.</p>
        </>
      )}
    </div>
  );
}
