import {
  CONVERSATION_TAB_ID,
  getTileGroups,
  type TileNode,
  type ThreadTileLayout,
} from "./threadTileLayout";

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function displayTileRoot(layout: ThreadTileLayout): TileNode {
  if (!layout.focusPairGroupId) return layout.root;
  const groups = getTileGroups(layout);
  const conversation = groups.find((group) => group.tabs.includes(CONVERSATION_TAB_ID));
  const target = groups.find((group) => group.id === layout.focusPairGroupId);
  return conversation && target && conversation.id !== target.id
    ? {
        kind: "split",
        id: "focus-pair-split",
        axis: "horizontal",
        ratio: layout.focusPairRatio ?? 0.55,
        first: conversation,
        second: target,
      }
    : layout.root;
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
  const center = (rect: TileRect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  const origin = center(current.rect);
  let best: { id: string; score: number } | null = null;
  for (const group of groups) {
    if (group.id === currentId) continue;
    const point = center(group.rect);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const forward =
      direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    if (forward <= 0.001) continue;
    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = forward + cross * 2;
    if (!best || score < best.score) best = { id: group.id, score };
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
