import type { TileNode } from "./threadTileLayout";

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
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
