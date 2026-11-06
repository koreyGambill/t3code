import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ThreadContextRecord } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";

import { useProject, useThreadShell } from "~/state/entities";
import { useRightPanelStore } from "../rightPanelStore";
import { useWorkspaceViewState } from "./reviews/workspaceViewState";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { ProjectFavicon } from "./ProjectFavicon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ThreadContextChip(props: {
  record: Pick<
    ThreadContextRecord,
    "environmentId" | "threadId" | "title" | "workspaceItemId" | "workspaceSection"
  >;
  copyMarkdown?: string;
  unreadable?: boolean;
}) {
  const { environmentId, threadId } = props.record;
  const shell = useThreadShell({ environmentId, threadId });
  const project = useProject(shell ? scopeProjectRef(environmentId, shell.projectId) : null);
  const title = props.record.workspaceItemId
    ? props.record.title
    : shell?.title?.trim() || props.record.title;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="thread"
            {...(props.unreadable ? { state: "invalid" as const } : {})}
            render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
            aria-label={`Thread, ${title}`}
            data-markdown-copy={props.copyMarkdown}
            className="no-underline"
            onClick={() => {
              if (!props.record.workspaceItemId) return;
              const ref = { environmentId, threadId };
              useRightPanelStore.getState().open(ref, "reviews");
              const section = props.record.workspaceSection;
              useRightPanelStore
                .getState()
                .setWorkspaceSection(
                  ref,
                  section === "actions"
                    ? "action-items"
                    : section === "design"
                      ? "design-notes"
                      : (section ?? "questions"),
                );
              useWorkspaceViewState
                .getState()
                .focusItem(`${environmentId}:${threadId}`, props.record.workspaceItemId);
            }}
          >
            {project ? (
              <ProjectFavicon project={project} className="size-[1em] self-center" />
            ) : (
              <MessagesSquareIcon />
            )}
            <ContextChipLabel>{title}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">
        {props.unreadable
          ? "On another machine, so this machine's agent can't read it. Remove it or switch back to send."
          : shell
            ? "Open thread"
            : "Thread no longer available"}
      </TooltipPopup>
    </Tooltip>
  );
}
