import { describe, expect, it } from "vite-plus/test";
import {
  applyTileAction,
  CONVERSATION_TAB_ID,
  getTileGroups,
  parseTileLayout,
  syncTileLayout,
} from "./threadTileLayout";

describe("thread tile layout", () => {
  it("moves tabs and splits conversation without losing or duplicating any tab", () => {
    let layout = syncTileLayout(undefined, [], ["a", "b"], "b", true);
    layout = applyTileAction(layout, {
      type: "move",
      tabId: "a",
      targetGroupId: "conversation-group",
      index: 0,
    });
    expect(getTileGroups(layout).map((group) => group.tabs)).toEqual([
      ["a", CONVERSATION_TAB_ID],
      ["b"],
    ]);
    layout = applyTileAction(layout, { type: "maximize", groupId: "conversation-group" });
    layout = applyTileAction(layout, {
      type: "split",
      tabId: CONVERSATION_TAB_ID,
      targetGroupId: "panels-group",
      axis: "vertical",
      side: "after",
      groupId: "chat-below",
      splitId: "vertical",
    });
    expect(getTileGroups(layout).map((group) => group.tabs)).toEqual([
      ["a"],
      ["b"],
      [CONVERSATION_TAB_ID],
    ]);
    expect(layout.focusedGroupId).toBe("chat-below");
    expect(layout.maximizedGroupId).toBeNull();
    layout = applyTileAction(layout, { type: "move", tabId: "b", targetGroupId: "chat-below" });
    expect(getTileGroups(layout).map((group) => group.tabs)).toEqual([
      ["a"],
      [CONVERSATION_TAB_ID, "b"],
    ]);
    expect(getTileGroups(layout).every((group) => group.tabs.length > 0)).toBe(true);
  });

  it("preserves independent active tabs while external activation selects the owning group", () => {
    let layout = syncTileLayout(undefined, [], ["a", "b"], "a", true);
    layout = applyTileAction(layout, {
      type: "move",
      tabId: "b",
      targetGroupId: "conversation-group",
    });
    layout = syncTileLayout(layout, ["a", "b"], ["a", "b", "c"], "c", true);
    expect(getTileGroups(layout).map((group) => group.activeTabId)).toEqual(["c", "a"]);
    layout = syncTileLayout(layout, ["a", "b", "c"], ["a", "b", "c"], "a", true);
    expect(layout.focusedGroupId).toBe("panels-group");
    expect(getTileGroups(layout).map((group) => group.activeTabId)).toEqual(["c", "a"]);
    const focused = applyTileAction(layout, { type: "focus", groupId: "conversation-group" });
    expect(
      syncTileLayout(focused, ["a", "b", "c"], ["a", "b", "c"], "a", false).focusedGroupId,
    ).toBe("conversation-group");
  });

  it("prunes closed groups and restores a usable conversation after maximizing", () => {
    let layout = syncTileLayout(undefined, [], ["a"], "a", true);
    layout = applyTileAction(layout, { type: "maximize", groupId: "panels-group" });
    expect(layout.maximizedGroupId).toBe("panels-group");
    layout = applyTileAction(layout, { type: "resize", splitId: "initial-split", ratio: 0.7 });
    expect(layout.root.kind === "split" && layout.root.ratio).toBe(0.7);
    layout = syncTileLayout(layout, ["a"], [], null, false);
    expect(getTileGroups(layout).map((group) => group.tabs)).toEqual([[CONVERSATION_TAB_ID]]);
    expect(layout.maximizedGroupId).toBeNull();
  });

  it("restores the layout when activating or focusing a group outside the maximized tile", () => {
    const initial = syncTileLayout(undefined, [], ["a"], "a", true);
    const maximized = applyTileAction(initial, { type: "maximize", groupId: "panels-group" });
    expect(
      applyTileAction(maximized, {
        type: "activate",
        groupId: "conversation-group",
        tabId: CONVERSATION_TAB_ID,
      }).maximizedGroupId,
    ).toBeNull();
    expect(
      applyTileAction(maximized, { type: "focus", groupId: "conversation-group" }).maximizedGroupId,
    ).toBeNull();
    expect(
      applyTileAction(maximized, { type: "activate", groupId: "panels-group", tabId: "a" })
        .maximizedGroupId,
    ).toBe("panels-group");
  });

  it("rejects malformed or cyclic persisted trees and repairs duplicate or obsolete tabs", () => {
    const raw = {
      root: {
        kind: "group",
        id: "g",
        tabs: ["conversation", "conversation", "gone"],
        activeTabId: "gone",
      },
      focusedGroupId: "missing",
      maximizedGroupId: "missing",
    };
    const parsed = parseTileLayout(raw);
    expect(parsed).toBeDefined();
    expect(getTileGroups(syncTileLayout(parsed, [], [], null, false))[0]?.tabs).toEqual([
      CONVERSATION_TAB_ID,
    ]);
    const cycle: Record<string, unknown> = {
      kind: "split",
      id: "cycle",
      axis: "horizontal",
      ratio: 0.5,
    };
    cycle.first = cycle;
    cycle.second = raw.root;
    expect(parseTileLayout({ ...raw, root: cycle })).toBeUndefined();
    expect(parseTileLayout({ ...raw, root: { ...raw.root, tabs: [] } })).toBeUndefined();
  });
});
