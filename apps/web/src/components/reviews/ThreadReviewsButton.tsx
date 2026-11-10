import type { ScopedThreadRef } from "@t3tools/contracts";
import { FilesIcon, ListChecksIcon } from "lucide-react";
import { useRightPanelStore } from "../../rightPanelStore";
import { Button } from "../ui/button";
export function ThreadReviewsButton({ threadRef }: { threadRef: ScopedThreadRef }) {
  const open = (section: "artifacts" | "qa") => {
    const panels = useRightPanelStore.getState();
    panels.openReviews(threadRef);
    panels.setWorkspaceSection(threadRef, section);
  };
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Artifacts"
        onClick={() => open("artifacts")}
      >
        <FilesIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Needs your QA across threads"
        onClick={() => open("qa")}
      >
        <ListChecksIcon />
      </Button>
    </>
  );
}
