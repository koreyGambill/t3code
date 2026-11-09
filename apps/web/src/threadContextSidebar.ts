import type { ScopedThreadRef } from "@t3tools/contracts";
import type { RightPanelSurface } from "./rightPanelStore";
import { getTileGroups, type ThreadTileLayout } from "./threadTileLayout";
import { displayTileRoot } from "./threadTileGeometry";

export function selectContextThread(
  owner: ScopedThreadRef | null,
  layout: ThreadTileLayout | null,
  surfaces: ReadonlyArray<RightPanelSurface>,
  pinned: ScopedThreadRef | null,
): ScopedThreadRef | null {
  if (pinned) return pinned;
  if (!owner || !layout) return owner;
  const groups = getTileGroups(displayTileRoot(layout));
  const group = groups.find(
    (entry) => entry.id === (layout.maximizedGroupId ?? layout.focusedGroupId),
  );
  const surface = surfaces.find((entry) => entry.id === group?.activeTabId);
  return surface?.kind === "side-chat"
    ? { environmentId: owner.environmentId, threadId: surface.threadId }
    : owner;
}
