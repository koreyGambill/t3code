import { AuthOrchestrationReadScope, type ScopedThreadRef } from "@t3tools/contracts";
import { ZapIcon } from "lucide-react";

import { useEnvironmentScope } from "../../state/session";
import { useRightPanelStore } from "../../rightPanelStore";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useEnvironmentQuery } from "../../state/query";
import { threadWorkspaceCounts } from "../../state/threadWorkspace";
import { useReviewSupport } from "./useReviewSupport";

export function ThreadReviewsButton({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId } = threadRef;
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const supported = useReviewSupport(environmentId);
  const query = useEnvironmentQuery(
    canRead && supported
      ? threadWorkspaceCounts({ environmentId, input: { threadId: threadRef.threadId } })
      : null,
  );
  const count = query.data ? query.data.unansweredQuestions + query.data.outstandingActions : 0;
  if (!canRead || !supported) return null;
  const label = "Workspace";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label={label}
            className="relative shrink-0 [-webkit-app-region:no-drag]"
            onClick={() => useRightPanelStore.getState().open(threadRef, "reviews")}
          >
            <ZapIcon className="size-4" />
            {count > 0 ? (
              <span
                aria-label={`${count} outstanding questions and action items`}
                className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-3xs leading-4 text-primary-foreground"
              >
                {count}
              </span>
            ) : null}
          </Button>
        }
      />
      <TooltipPopup side="bottom">
        {label}
        {query.data
          ? ` · ${query.data.unansweredQuestions} unanswered questions, ${query.data.outstandingActions} unfinished actions`
          : ""}
      </TooltipPopup>
    </Tooltip>
  );
}
