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

  it("swaps whole groups with their identity and active tabs intact", () => {
    const initial = syncTileLayout(undefined, [], ["a", "b"], "b", true);
    const maximized = applyTileAction(initial, { type: "maximize", groupId: "panels-group" });
    const swapped = applyTileAction(maximized, {
      type: "swap-groups",
      firstGroupId: "panels-group",
      secondGroupId: "conversation-group",
    });
    expect(getTileGroups(swapped)).toEqual(getTileGroups(initial).toReversed());
    expect(swapped.focusedGroupId).toBe("panels-group");
    expect(swapped.maximizedGroupId).toBeNull();
    expect(parseTileLayout(JSON.parse(JSON.stringify(swapped)))).toEqual(swapped);
    const merged = applyTileAction(maximized, {
      type: "merge-groups",
      groupId: "panels-group",
      targetGroupId: "conversation-group",
    });
    expect(getTileGroups(merged)).toEqual([
      {
        ...getTileGroups(initial)[0],
        tabs: [CONVERSATION_TAB_ID, "a", "b"],
        activeTabId: "b",
      },
    ]);
    expect(merged.focusedGroupId).toBe("conversation-group");
    expect(merged.maximizedGroupId).toBeNull();
    expect(parseTileLayout(JSON.parse(JSON.stringify(merged)))).toEqual(merged);
    for (const [groupId, targetGroupId] of [
      ["panels-group", "panels-group"],
      ["missing", "conversation-group"],
      ["panels-group", "missing"],
    ]) {
      expect(
        applyTileAction(maximized, {
          type: "merge-groups",
          groupId: groupId!,
          targetGroupId: targetGroupId!,
        }),
      ).toBe(maximized);
    }
    for (const [firstGroupId, secondGroupId] of [
      ["panels-group", "panels-group"],
      ["missing", "conversation-group"],
      ["panels-group", "initial-split"],
    ]) {
      expect(
        applyTileAction(maximized, {
          type: "swap-groups",
          firstGroupId: firstGroupId!,
          secondGroupId: secondGroupId!,
        }),
      ).toBe(maximized);
    }
  });

  it("docks whole groups across nested branches and collapses their old split", () => {
    let initial = syncTileLayout(undefined, [], ["a", "b", "c"], "b", true);
    initial = applyTileAction(initial, {
      type: "split",
      tabId: "c",
      targetGroupId: "panels-group",
      axis: "vertical",
      side: "after",
      groupId: "terminal-group",
      splitId: "nested-split",
    });
    const groups = getTileGroups(initial);
    expect(groups.map((group) => group.colorIndex)).toEqual([0, 1, 2]);
    for (const [groupId, targetGroupId, side, expected] of [
      ["panels-group", "conversation-group", "before", [groups[1], groups[0], groups[2]]],
      ["conversation-group", "panels-group", "after", [groups[1], groups[0], groups[2]]],
      ["panels-group", "terminal-group", "after", [groups[0], groups[2], groups[1]]],
    ] as const) {
      const docked = applyTileAction(initial, {
        type: "dock-group",
        groupId,
        targetGroupId,
        axis: "horizontal",
        side,
        splitId: "docked-split",
      });
      expect(getTileGroups(docked)).toEqual(expected);
      expect(docked.focusedGroupId).toBe(groupId);
      expect(docked.maximizedGroupId).toBeNull();
      expect(parseTileLayout(JSON.parse(JSON.stringify(docked)))).toEqual(docked);
      expect(docked.root).toMatchObject({
        kind: "split",
        id: groupId === "conversation-group" ? "nested-split" : "initial-split",
      });
    }
    for (const [groupId, targetGroupId, splitId] of [
      ["panels-group", "panels-group", "new-split"],
      ["missing", "conversation-group", "new-split"],
      ["panels-group", "missing", "new-split"],
      ["panels-group", "conversation-group", "nested-split"],
      ["panels-group", "conversation-group", "terminal-group"],
    ]) {
      expect(
        applyTileAction(initial, {
          type: "dock-group",
          groupId: groupId!,
          targetGroupId: targetGroupId!,
          axis: "vertical",
          side: "before",
          splitId: splitId!,
        }),
      ).toBe(initial);
    }
  });

  it("keeps new groups empty until an area is chosen and collapses them after that area closes", () => {
    const initial = syncTileLayout(undefined, [], [], null, false);
    const empty = applyTileAction(initial, {
      type: "new-group",
      targetGroupId: "conversation-group",
      axis: "horizontal",
      side: "after",
      groupId: "chooser-group",
      splitId: "chooser-split",
    });
    expect(getTileGroups(empty)).toEqual([
      ...getTileGroups(initial),
      { kind: "group", id: "chooser-group", tabs: [], activeTabId: "", colorIndex: 1 },
    ]);
    expect(empty.focusedGroupId).toBe("chooser-group");
    expect(applyTileAction(empty, { type: "close-group", groupId: "chooser-group" })).toEqual(
      initial,
    );
    expect(applyTileAction(empty, { type: "close-group", groupId: "conversation-group" })).toBe(
      empty,
    );
    expect(applyTileAction(empty, { type: "close-group", groupId: "missing" })).toBe(empty);
    const loneEmpty = parseTileLayout({
      root: { kind: "group", id: "empty", tabs: [], activeTabId: "" },
      focusedGroupId: "empty",
    })!;
    expect(applyTileAction(loneEmpty, { type: "close-group", groupId: "empty" })).toBe(loneEmpty);
    expect(
      applyTileAction(empty, {
        type: "merge-groups",
        groupId: "chooser-group",
        targetGroupId: "conversation-group",
      }),
    ).toBe(empty);
    const restored = parseTileLayout(JSON.parse(JSON.stringify(empty)));
    expect(restored).toEqual(empty);
    expect(syncTileLayout(restored, [], [], null, false)).toEqual(empty);
    const chosen = syncTileLayout(restored, [], ["files"], "files", true);
    expect(getTileGroups(chosen).map((group) => group.tabs)).toEqual([
      [CONVERSATION_TAB_ID],
      ["files"],
    ]);
    expect(getTileGroups(chosen)[1]?.activeTabId).toBe("files");
    expect(chosen.focusedGroupId).toBe("chooser-group");
    expect(syncTileLayout(chosen, ["files"], [], null, false)).toEqual(initial);
    const anotherChooser = applyTileAction(chosen, {
      type: "new-group",
      targetGroupId: "conversation-group",
      axis: "vertical",
      side: "after",
      groupId: "another-chooser",
      splitId: "another-split",
    });
    const existingChosen = syncTileLayout(anotherChooser, ["files"], ["files"], "files", true);
    expect(getTileGroups(existingChosen).map((group) => [group.id, group.tabs])).toEqual([
      ["conversation-group", [CONVERSATION_TAB_ID]],
      ["another-chooser", ["files"]],
    ]);
    expect(existingChosen.focusedGroupId).toBe("another-chooser");
    expect(getTileGroups(existingChosen)[1]?.activeTabId).toBe("files");
    const moved = applyTileAction(chosen, {
      type: "move",
      tabId: "files",
      targetGroupId: "conversation-group",
    });
    expect(getTileGroups(moved).map((group) => group.tabs)).toEqual([
      [CONVERSATION_TAB_ID, "files"],
    ]);
    const swapped = applyTileAction(empty, {
      type: "swap-groups",
      firstGroupId: "chooser-group",
      secondGroupId: "conversation-group",
    });
    expect(getTileGroups(swapped)).toEqual(getTileGroups(empty).toReversed());
    const docked = applyTileAction(swapped, {
      type: "dock-group",
      groupId: "chooser-group",
      targetGroupId: "conversation-group",
      axis: "vertical",
      side: "after",
      splitId: "docked-chooser",
    });
    expect(getTileGroups(docked)).toEqual(getTileGroups(empty));
    expect(parseTileLayout(JSON.parse(JSON.stringify(docked)))).toEqual(docked);
    for (const [targetGroupId, groupId, splitId] of [
      ["missing", "empty", "split"],
      ["conversation-group", "conversation-group", "split"],
      ["conversation-group", "empty", "conversation-group"],
      ["conversation-group", "same", "same"],
    ]) {
      expect(
        applyTileAction(initial, {
          type: "new-group",
          targetGroupId: targetGroupId!,
          groupId: groupId!,
          splitId: splitId!,
          axis: "horizontal",
          side: "after",
        }),
      ).toBe(initial);
    }
  });

  it("focuses any two tabs without moving them and restores the layout after focus closes", () => {
    const initial = syncTileLayout(undefined, [], ["files", "notes"], "files", true);
    const paired = applyTileAction(initial, { type: "focus-pair", groupId: "panels-group" });
    expect(paired.root).toBe(initial.root);
    expect(paired.focusPairRightTabId).toBe("files");
    expect(paired.focusPairLeftTabId).toBeNull();
    const selected = applyTileAction(paired, { type: "focus-left", tabId: "notes" });
    expect(selected.root).toBe(initial.root);
    expect(selected.focusedGroupId).toBe("focus-left-group");
    expect(applyTileAction(selected, { type: "focus-left", tabId: "files" })).toBe(selected);
    expect(applyTileAction(selected, { type: "focus-left", tabId: "missing" })).toBe(selected);
    const resized = applyTileAction(selected, { type: "resize-focus-pair", ratio: 0.7 });
    expect(parseTileLayout(JSON.parse(JSON.stringify(resized)))).toEqual(resized);
    const maximized = applyTileAction(resized, { type: "maximize", groupId: "focus-left-group" });
    expect(maximized.maximizedGroupId).toBe("focus-left-group");
    expect(maximized.focusPairRightTabId).toBe("files");
    expect(applyTileAction(maximized, { type: "maximize", groupId: null }).focusPairLeftTabId).toBe(
      "notes",
    );
    expect(parseTileLayout(JSON.parse(JSON.stringify(maximized)))).toEqual(maximized);
    const externalLeft = syncTileLayout(
      selected,
      ["files", "notes"],
      ["files", "notes"],
      "notes",
      true,
    );
    expect(externalLeft.focusPairRightTabId).toBe("files");
    expect(externalLeft.focusPairLeftTabId).toBe("notes");
    expect(externalLeft.focusedGroupId).toBe("focus-left-group");
    const switchedRight = applyTileAction(selected, {
      type: "activate",
      groupId: "panels-group",
      tabId: "notes",
    });
    expect(switchedRight.focusPairRightTabId).toBe("files");
    expect(switchedRight.focusPairLeftTabId).toBe("notes");
    expect(switchedRight.focusedGroupId).toBe("focus-left-group");
    expect(switchedRight.root).toBe(initial.root);
    const switchedLeft = applyTileAction(selected, {
      type: "activate",
      groupId: "focus-left-group",
      tabId: CONVERSATION_TAB_ID,
    });
    expect(switchedLeft.focusPairLeftTabId).toBe(CONVERSATION_TAB_ID);
    expect(switchedLeft.root).toBe(initial.root);
    const externalRight = applyTileAction(selected, {
      type: "activate",
      groupId: "conversation-group",
      tabId: CONVERSATION_TAB_ID,
    });
    expect(externalRight.focusPairRightTabId).toBe(CONVERSATION_TAB_ID);
    expect(externalRight.focusPairLeftTabId).toBe("notes");
    const withNewArea = syncTileLayout(
      selected,
      ["files", "notes"],
      ["files", "notes", "inspect"],
      "inspect",
      true,
    );
    expect(withNewArea.focusPairGroupId).toBeNull();
    expect(getTileGroups(withNewArea).some((group) => group.tabs.includes("inspect"))).toBe(true);
    expect(
      syncTileLayout(selected, ["files", "notes"], ["files"], "files", false).focusPairLeftTabId,
    ).toBeNull();
    expect(
      syncTileLayout(selected, ["files", "notes"], ["notes"], "notes", false).focusPairGroupId,
    ).toBeNull();
    expect(applyTileAction(selected, { type: "focus-pair", groupId: null }).root).toBe(
      initial.root,
    );
    expect(applyTileAction(selected, { type: "focus-pair", groupId: null }).focusedGroupId).toBe(
      "panels-group",
    );
    const created = applyTileAction(selected, {
      type: "new-group",
      targetGroupId: "panels-group",
      axis: "vertical",
      side: "after",
      groupId: "empty",
      splitId: "empty-split",
    });
    expect(created.focusPairGroupId).toBeNull();
    const split = applyTileAction(selected, {
      type: "split",
      tabId: "notes",
      targetGroupId: "panels-group",
      axis: "vertical",
      side: "after",
      groupId: "split-notes",
      splitId: "notes-split",
    });
    expect(split.focusPairGroupId).toBeNull();
    expect(
      parseTileLayout({ ...initial, focusPairGroupId: "panels-group" })?.focusPairRightTabId,
    ).toBe("files");
    expect(
      parseTileLayout({
        ...initial,
        focusPairGroupId: "panels-group",
        maximizedGroupId: "conversation-group",
      })?.maximizedGroupId,
    ).toBeNull();
    expect(
      parseTileLayout({
        ...initial,
        focusPairGroupId: "panels-group",
        focusedGroupId: "conversation-group",
      })?.focusedGroupId,
    ).toBe("panels-group");
    expect(parseTileLayout({ ...paired, focusPairRatio: 12 })?.focusPairRatio).toBe(0.9);
    expect(applyTileAction(selected, { type: "resize-focus-pair", ratio: NaN })).toBe(selected);
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
    expect(parsed && getTileGroups(parsed)[0]?.colorIndex).toBe(0);
    expect(
      getTileGroups(parseTileLayout({ ...raw, root: { ...raw.root, colorIndex: 7 } })!)[0]
        ?.colorIndex,
    ).toBe(7);
    for (const colorIndex of [-1, 8, 1.5, "blue"]) {
      expect(
        getTileGroups(parseTileLayout({ ...raw, root: { ...raw.root, colorIndex } })!)[0]
          ?.colorIndex,
      ).toBe(0);
    }
    const legacySplit = syncTileLayout(undefined, [], ["a"], "a", true);
    legacySplit.root = {
      kind: "split",
      id: "legacy",
      axis: "horizontal",
      ratio: 0.5,
      first: { kind: "group", id: "first", tabs: ["conversation"], activeTabId: "conversation" },
      second: { kind: "group", id: "second", tabs: ["a"], activeTabId: "a", colorIndex: 0 },
    };
    expect(getTileGroups(parseTileLayout(legacySplit)!).map((group) => group.colorIndex)).toEqual([
      1, 0,
    ]);
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
