import { describe, expect, it } from "vite-plus/test";
import { directionalTile, tileGeometry } from "./threadTileGeometry";
import type { TileNode } from "./threadTileLayout";

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
});
