import { AuthOrchestrationReadScope, type ScopedThreadRef } from "@t3tools/contracts";
import { ZapIcon } from "lucide-react";

import { useEnvironmentScope } from "../../state/session";
import { useRightPanelStore } from "../../rightPanelStore";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useReviewSupport } from "./useReviewSupport";

export function ThreadReviewsButton({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId } = threadRef;
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const supported = useReviewSupport(environmentId);
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
            className="shrink-0 [-webkit-app-region:no-drag]"
            onClick={() => useRightPanelStore.getState().open(threadRef, "reviews")}
          >
            <ZapIcon className="size-4" />
          </Button>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
