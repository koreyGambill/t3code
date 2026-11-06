import { AuthOrchestrationReadScope, type ScopedThreadRef } from "@t3tools/contracts";
import { ClipboardListIcon } from "lucide-react";
import { useEffect } from "react";

import { threadWorkspaceGet } from "../../state/threadWorkspace";
import { reviewArtifactsList } from "../../state/reviews";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useRightPanelStore } from "../../rightPanelStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { useReviewSupport } from "./useReviewSupport";

export function ThreadReviewsButton({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const now = Date.parse(`${useNowMinute()}Z`);
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const supported = useReviewSupport(environmentId);
  const reviews = useEnvironmentQuery(
    canRead && supported
      ? reviewArtifactsList({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const workspace = useEnvironmentQuery(
    canRead && supported ? threadWorkspaceGet({ environmentId, input: { threadId } }) : null,
  );
  const newestId = reviews.data?.[0]?.id;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers discovered reviews as a tab without changing the user's selected surface or opening the panel.
  useEffect(() => {
    if (newestId) useRightPanelStore.getState().offerReviews({ environmentId, threadId }, newestId);
  }, [environmentId, threadId, newestId]);
  if (!canRead || !supported) return null;
  const pending =
    (reviews.data?.filter(
      (review) =>
        review.lastSubmittedRevision !== review.revision &&
        (!review.remindAt || Date.parse(review.remindAt) <= now),
    ).length ?? 0) +
    (workspace.data?.actionItems.filter((item) => item.status === "open").length ?? 0);
  return (
    <Button
      variant="ghost-muted"
      size="sm"
      className="shrink-0 [-webkit-app-region:no-drag]"
      onClick={() => useRightPanelStore.getState().open(threadRef, "reviews")}
    >
      <ClipboardListIcon className="size-3.5" />
      Workspace{pending > 0 ? <span className="text-xs text-primary">{pending}</span> : null}
    </Button>
  );
}
