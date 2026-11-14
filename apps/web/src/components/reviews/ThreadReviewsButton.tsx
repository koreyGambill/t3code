import type { ScopedThreadRef } from "@t3tools/contracts";
import { FilesIcon, ListChecksIcon } from "lucide-react";
import { useRightPanelStore } from "../../rightPanelStore";
import { useThreadContextSidebarStore } from "../../threadContextSidebarStore";
import { Button } from "../ui/button";
export function ThreadReviewsButton({ threadRef }: { threadRef: ScopedThreadRef }) {
  const open = (section: "artifacts" | "qa") => {
    if (section === "artifacts")
      useThreadContextSidebarStore.getState().show("artifacts", { thread: threadRef });
    else useRightPanelStore.getState().open(threadRef, "reviews");
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
