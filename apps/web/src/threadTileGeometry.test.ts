import { describe, expect, it } from "vite-plus/test";
import {
  displayTileRoot,
  directionalTile,
  tileGeometry,
  resizeTileSplits,
  resizeTileRatio,
} from "./threadTileGeometry";
import { syncTileLayout, applyTileAction, getTileGroups, type TileNode } from "./threadTileLayout";

describe("tile geometry", () => {
  it("covers nested splits and navigates to the nearest tile in each direction", () => {
    const group = (id: string): TileNode => ({ kind: "group", id, tabs: [id], activeTabId: id });
    const root: TileNode = {
      kind: "split",
      id: "columns",
      axis: "horizontal",
      ratio: 0.6,
      first: group("chat"),
      second: {
        kind: "split",
        id: "rows",
        axis: "vertical",
        ratio: 0.4,
        first: group("browser"),
        second: group("terminal"),
      },
    };
    const geometry = tileGeometry(root);
    expect(geometry.groups).toEqual([
      { id: "chat", rect: { x: 0, y: 0, width: 0.6, height: 1 } },
      { id: "browser", rect: { x: 0.6, y: 0, width: 0.4, height: 0.4 } },
      { id: "terminal", rect: { x: 0.6, y: 0.4, width: 0.4, height: 0.6 } },
    ]);
    expect(directionalTile(geometry.groups, "browser", "down")).toBe("terminal");
    expect(directionalTile(geometry.groups, "terminal", "left")).toBe("chat");
    expect(directionalTile(geometry.groups, "chat", "left")).toBeNull();
    expect(directionalTile(geometry.groups, "chat", "right")).toBe("terminal");
  });
  it("resizes only ancestor dividers bordering the focused tile and chooses the pointer's nearest edges", () => {
    const group = (id: string): TileNode => ({ kind: "group", id, tabs: [id], activeTabId: id });
    const root: TileNode = {
      kind: "split",
      id: "outer",
      axis: "horizontal",
      ratio: 0.2,
      first: group("left"),
      second: {
        kind: "split",
        id: "rows",
        axis: "vertical",
        ratio: 0.7,
        second: group("bottom"),
        first: {
          kind: "split",
          id: "inner",
          axis: "horizontal",
          ratio: 0.5,
          second: group("right"),
          first: {
            kind: "split",
            id: "near",
            axis: "horizontal",
            ratio: 0.5,
            first: group("middle"),
            second: group("focused"),
          },
        },
      },
    };
    const leftEdges = resizeTileSplits(root, "focused", { x: 0.41, y: 0.6 });
    expect(leftEdges.map((split) => split.id)).toEqual(["near", "rows"]);
    expect(leftEdges[0]).toMatchObject({
      ratio: 0.5,
      rect: { x: 0.2, y: 0, width: 0.4, height: 0.7 },
    });
    expect(resizeTileSplits(root, "focused", { x: 0.59, y: 0.6 }).map((split) => split.id)).toEqual(
      ["inner", "rows"],
    );
    const transpose = (node: TileNode): TileNode =>
      node.kind === "group"
        ? node
        : {
            ...node,
            axis: node.axis === "horizontal" ? "vertical" : "horizontal",
            first: transpose(node.first),
            second: transpose(node.second),
          };
    const transposedEdges = resizeTileSplits(transpose(root), "focused", { x: 0.6, y: 0.41 });
    expect(transposedEdges.map((split) => split.id)).toEqual(["rows", "near"]);
    expect(resizeTileRatio(transposedEdges[1]!, { x: 0, y: 0.04 })).toBeCloseTo(0.6);
    expect(
      resizeTileSplits(transpose(root), "focused", { x: 0.6, y: 0.59 }).map((split) => split.id),
    ).toEqual(["rows", "inner"]);
    expect(resizeTileSplits(root, "missing", { x: 0, y: 0 })).toEqual([]);
    expect(resizeTileSplits(group("only"), "only", { x: 0, y: 0 })).toEqual([]);
    expect(resizeTileRatio(leftEdges[0]!, { x: 0.04, y: 0 })).toBeCloseTo(0.6);
    expect(resizeTileRatio(leftEdges[1]!, { x: 0, y: -0.1 })).toBeCloseTo(0.6);
    expect(resizeTileRatio(leftEdges[0]!, { x: 1, y: 0 })).toBe(0.9);
    expect(resizeTileRatio(leftEdges[0]!, { x: -1, y: 0 })).toBe(0.1);
    expect(resizeTileRatio(leftEdges[0]!, { x: NaN, y: 0 })).toBe(0.5);
  });
  it("projects conversation and chosen tile without changing their active tabs or the stored tree", () => {
    let initial = syncTileLayout(undefined, [], ["files", "notes"], "files", true);
    initial = applyTileAction(initial, {
      type: "move",
      tabId: "notes",
      targetGroupId: "conversation-group",
    });
    const paired = applyTileAction(initial, { type: "focus-pair", groupId: "panels-group" });
    const root = displayTileRoot(paired);
    expect(root).toMatchObject({
      kind: "split",
      id: "focus-pair-split",
      axis: "horizontal",
      ratio: 0.55,
    });
    const groups = getTileGroups(initial);
    expect(getTileGroups(root)).toEqual(groups);
    expect(root.kind === "split" && root.first).toBe(groups[0]);
    expect(root.kind === "split" && root.second).toBe(groups[1]);
    expect(groups[0]?.activeTabId).toBe("notes");
    expect(paired.root).toBe(initial.root);
    expect(
      resizeTileSplits(root, "panels-group", { x: 0.8, y: 0.5 }).map((split) => split.id),
    ).toEqual(["focus-pair-split"]);
    expect(displayTileRoot({ ...paired, focusPairGroupId: "missing" })).toBe(initial.root);
    expect(displayTileRoot({ ...paired, focusPairGroupId: null })).toBe(initial.root);
  });
});
