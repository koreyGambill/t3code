import { getTileGroups, type TileNode, type ThreadTileLayout } from "./threadTileLayout";

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function tileDropOrder<T extends { id: string }>(
  groups: readonly T[],
  focusedFloatingId: string | null,
): T[] {
  return groups
    .toReversed()
    .sort((a, b) => Number(b.id === focusedFloatingId) - Number(a.id === focusedFloatingId));
}

export function isFocusOverviewGroup(id: string) {
  return id.startsWith("focus-overview:");
}

function focusOverview(node: TileNode, excludedTabId: string): TileNode | null {
  if (node.kind === "group") {
    const tabs = node.tabs.filter((tabId) => tabId !== excludedTabId);
    return tabs.length
      ? {
          ...node,
          id: `focus-overview:${node.id}`,
          tabs,
          activeTabId: tabs.includes(node.activeTabId) ? node.activeTabId : tabs[0]!,
        }
      : null;
  }
  const first = focusOverview(node.first, excludedTabId);
  const second = focusOverview(node.second, excludedTabId);
  return first && second
    ? { ...node, id: `focus-overview-split:${node.id}`, first, second }
    : (first ?? second);
}

export function displayTileRoot(layout: ThreadTileLayout): TileNode {
  if (!layout.focusPairGroupId) return layout.root;
  const groups = getTileGroups(layout);
  const right = groups.find((group) => group.id === layout.focusPairGroupId);
  const rightTabId = layout.focusPairRightTabId ?? right?.activeTabId;
  if (!right || !right.tabs.includes(rightTabId ?? "")) return layout.root;
  const leftOwner =
    layout.focusPairLeftTabId && layout.focusPairLeftTabId !== rightTabId
      ? groups.find((group) => group.tabs.includes(layout.focusPairLeftTabId!))
      : undefined;
  const left: TileNode = leftOwner
    ? {
        ...leftOwner,
        id: "focus-left-group",
        tabs: [layout.focusPairLeftTabId!],
        activeTabId: layout.focusPairLeftTabId!,
      }
    : (focusOverview(layout.root, rightTabId!) ?? {
        kind: "group",
        id: "focus-left-chooser",
        tabs: [],
        activeTabId: "",
        colorIndex: right.colorIndex ?? 0,
      });
  return {
    kind: "split",
    id: "focus-pair-split",
    axis: "horizontal",
    ratio: layout.focusPairRatio ?? 0.55,
    first: left,
    second: {
      ...right,
      tabs: leftOwner
        ? right.tabs.filter((tabId) => tabId !== layout.focusPairLeftTabId)
        : [rightTabId!],
      activeTabId: rightTabId!,
    },
  };
}

export function tileGeometry(root: TileNode) {
  const groups: Array<{ id: string; rect: TileRect }> = [];
  const splits: Array<{
    id: string;
    axis: "horizontal" | "vertical";
    ratio: number;
    rect: TileRect;
  }> = [];
  const visit = (node: TileNode, rect: TileRect) => {
    if (node.kind === "group") {
      groups.push({ id: node.id, rect });
      return;
    }
    splits.push({ id: node.id, axis: node.axis, ratio: node.ratio, rect });
    if (node.axis === "horizontal") {
      visit(node.first, { ...rect, width: rect.width * node.ratio });
      visit(node.second, {
        ...rect,
        x: rect.x + rect.width * node.ratio,
        width: rect.width * (1 - node.ratio),
      });
    } else {
      visit(node.first, { ...rect, height: rect.height * node.ratio });
      visit(node.second, {
        ...rect,
        y: rect.y + rect.height * node.ratio,
        height: rect.height * (1 - node.ratio),
      });
    }
  };
  visit(root, { x: 0, y: 0, width: 1, height: 1 });
  return { groups, splits };
}

export function directionalTile(
  groups: readonly { id: string; rect: TileRect }[],
  currentId: string,
  direction: "left" | "right" | "up" | "down",
) {
  const current = groups.find((group) => group.id === currentId);
  if (!current) return null;
  const horizontal = direction === "left" || direction === "right";
  const reverse = direction === "left" || direction === "up";
  const currentStart = horizontal ? current.rect.x : current.rect.y;
  const currentSize = horizontal ? current.rect.width : current.rect.height;
  const currentCrossStart = horizontal ? current.rect.y : current.rect.x;
  const currentCrossSize = horizontal ? current.rect.height : current.rect.width;
  let best: { id: string; overlap: boolean; gap: number; cross: number } | null = null;
  for (const group of groups) {
    if (group.id === currentId) continue;
    const start = horizontal ? group.rect.x : group.rect.y;
    const size = horizontal ? group.rect.width : group.rect.height;
    const gap = reverse ? currentStart - start - size : start - currentStart - currentSize;
    if (gap < -1e-9) continue;
    const crossStart = horizontal ? group.rect.y : group.rect.x;
    const crossSize = horizontal ? group.rect.height : group.rect.width;
    const overlap =
      Math.min(currentCrossStart + currentCrossSize, crossStart + crossSize) -
        Math.max(currentCrossStart, crossStart) >
      1e-9;
    const cross = Math.abs(crossStart + crossSize / 2 - currentCrossStart - currentCrossSize / 2);
    const candidate = { id: group.id, overlap, gap: Math.max(0, gap), cross };
    if (
      !best ||
      (candidate.overlap && !best.overlap) ||
      (candidate.overlap === best.overlap &&
        (candidate.gap < best.gap ||
          (candidate.gap === best.gap &&
            (candidate.cross < best.cross ||
              (candidate.cross === best.cross && candidate.id < best.id)))))
    )
      best = candidate;
  }
  return best?.id ?? null;
}

export type TileResizeSplit = ReturnType<typeof tileGeometry>["splits"][number];

export function resizeTileSplits(
  root: TileNode,
  groupId: string,
  pointer: { x: number; y: number },
) {
  const { groups, splits } = tileGeometry(root);
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) return [];
  const center = {
    x: group.rect.x + group.rect.width / 2,
    y: group.rect.y + group.rect.height / 2,
  };
  const borders = splits.filter((split) => {
    if (split.id.startsWith("focus-overview-split:")) return false;
    const rect = split.rect;
    if (
      center.x <= rect.x ||
      center.x >= rect.x + rect.width ||
      center.y <= rect.y ||
      center.y >= rect.y + rect.height
    )
      return false;
    const divider =
      split.axis === "horizontal"
        ? rect.x + rect.width * split.ratio
        : rect.y + rect.height * split.ratio;
    const start = split.axis === "horizontal" ? group.rect.x : group.rect.y;
    const size = split.axis === "horizontal" ? group.rect.width : group.rect.height;
    return Math.abs(divider - start) < 1e-9 || Math.abs(divider - start - size) < 1e-9;
  });
  return (["horizontal", "vertical"] as const).flatMap((axis) => {
    let nearest: TileResizeSplit | undefined;
    let distance = Infinity;
    for (const split of borders) {
      if (split.axis !== axis) continue;
      const divider =
        axis === "horizontal"
          ? split.rect.x + split.rect.width * split.ratio
          : split.rect.y + split.rect.height * split.ratio;
      const nextDistance = Math.abs((axis === "horizontal" ? pointer.x : pointer.y) - divider);
      if (nextDistance < distance) {
        nearest = split;
        distance = nextDistance;
      }
    }
    return nearest ? [nearest] : [];
  });
}

export function resizeTileRatio(split: TileResizeSplit, delta: { x: number; y: number }) {
  const distance = split.axis === "horizontal" ? delta.x : delta.y;
  const size = split.axis === "horizontal" ? split.rect.width : split.rect.height;
  return Number.isFinite(distance) && size > 0
    ? Math.max(0.1, Math.min(0.9, split.ratio + distance / size))
    : split.ratio;
}
