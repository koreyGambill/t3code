import type { ScopedThreadRef } from "@t3tools/contracts";
import type { RightPanelSurface } from "./rightPanelStore";
import type { ThreadTileLayout } from "./threadTileLayout";
import { visibleTileGroups } from "./threadTileGeometry";

export function selectContextThread(
  owner: ScopedThreadRef | null,
  layout: ThreadTileLayout | null,
  surfaces: ReadonlyArray<RightPanelSurface>,
  pinned: ScopedThreadRef | null,
): ScopedThreadRef | null {
  if (pinned) return pinned;
  if (!owner || !layout) return owner;
  const groups = visibleTileGroups(layout);
  const group =
    groups.find((entry) => entry.id === layout.focusedGroupId) ??
    groups.find((entry) => entry.id === layout.maximizedGroupId);
  const surface = surfaces.find((entry) => entry.id === group?.activeTabId);
  return surface?.kind === "side-chat"
    ? { environmentId: owner.environmentId, threadId: surface.threadId }
    : owner;
}
