import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ThreadWorkspaceSection } from "../../rightPanelStore";

export function ThreadWorkspacePanel(_props: {
  readonly threadRef: ScopedThreadRef;
  readonly surfaceId?: string;
  readonly reviewId: string | null;
  readonly visible: boolean;
  readonly startedThread: boolean;
  readonly section: ThreadWorkspaceSection;
}) {
  return null;
}
