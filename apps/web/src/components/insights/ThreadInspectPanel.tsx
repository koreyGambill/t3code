import type { DefaultContextGetInput, ScopedThreadRef } from "@t3tools/contracts";
import { CoinsIcon, FileTextIcon, LayersIcon, ListStartIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DefaultContextPanel } from "./DefaultContextPanel";
import { ThreadContextPanel } from "./ThreadContextPanel";
import { ThreadInsightsPanel } from "./ThreadInsightsPanel";

export type ThreadInspectSection = "loads" | "tokens" | "context" | "defaults";

const sections = [
  ["loads", "Loads", FileTextIcon],
  ["context", "Context", LayersIcon],
  ["tokens", "Tokens", CoinsIcon],
  ["defaults", "Default context", ListStartIcon],
] as const;

export function ThreadInspectPanel({
  threadRef,
  section,
  visible,
  startedThread,
  draft,
  onSectionChange,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly section: ThreadInspectSection;
  readonly visible: boolean;
  readonly startedThread: boolean;
  /** What a draft thread will start with, so Default can preview it before the first message. */
  readonly draft?: Omit<DefaultContextGetInput, "threadId"> | undefined;
  readonly onSectionChange: (section: ThreadInspectSection) => void;
}) {
  const tabs = (
    <div role="tablist" aria-label="Inspect sections" className="flex shrink-0 gap-0.5">
      {sections.map(([id, label, Icon]) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                role="tab"
                aria-label={label}
                aria-selected={section === id}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted aria-selected:bg-muted aria-selected:text-foreground"
                onClick={() => onSectionChange(id)}
              />
            }
          >
            <Icon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>{label}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
  const panelKey = `${threadRef.environmentId}:${threadRef.threadId}`;
  if (section === "defaults" && (startedThread || draft !== undefined))
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <DefaultContextPanel
          key={panelKey}
          threadRef={threadRef}
          request={{ threadId: threadRef.threadId, ...(startedThread ? {} : draft) }}
          visible={visible}
          tabs={tabs}
        />
      </div>
    );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {startedThread ? (
        section === "context" ? (
          <ThreadContextPanel key={panelKey} threadRef={threadRef} visible={visible} tabs={tabs} />
        ) : (
          <ThreadInsightsPanel
            threadRef={threadRef}
            visible={visible}
            mode={section === "defaults" ? "loads" : section}
            tabs={tabs}
          />
        )
      ) : (
        <>
          <div className="flex min-h-7 shrink-0 items-center border-b border-border px-1">
            {tabs}
          </div>
          <p className="p-2 text-xs text-muted-foreground">
            Send a message to inspect activity. Default context shows what will load first.
          </p>
        </>
      )}
    </div>
  );
}
