import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { selectContextThread } from "./threadContextSidebar";
import { applyTileAction, syncTileLayout } from "./threadTileLayout";
import { useThreadContextSidebarStore } from "./threadContextSidebarStore";

const owner = { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("owner") };
const child = { environmentId: owner.environmentId, threadId: ThreadId.make("child") };
const surfaces = [{ id: "side-chat:child", kind: "side-chat", threadId: child.threadId }] as const;

describe("thread context sidebar selection", () => {
  it("follows the active thread through split, floating, maximized and Focus layouts", () => {
    const split = syncTileLayout(undefined, [], ["side-chat:child"], "side-chat:child", true);
    expect(selectContextThread(owner, split, surfaces, null)).toEqual(child);
    const mainGroup = split.root.kind === "split" ? split.root.first.id : "";
    const main = applyTileAction(split, { type: "focus", groupId: mainGroup });
    expect(selectContextThread(owner, main, surfaces, null)).toEqual(owner);
    const floating = applyTileAction(split, {
      type: "float-group",
      groupId: "panels-group",
      rect: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
    });
    expect(selectContextThread(owner, floating, surfaces, null)).toEqual(child);
    const maximized = applyTileAction(floating, { type: "maximize", groupId: "panels-group" });
    expect(selectContextThread(owner, maximized, surfaces, null)).toEqual(child);
    const focus = applyTileAction(split, { type: "focus-pair", groupId: "panels-group" });
    expect(selectContextThread(owner, focus, surfaces, null)).toEqual(child);
    const left = applyTileAction(focus, { type: "focus", groupId: "focus-left-group" });
    expect(selectContextThread(owner, left, surfaces, null)).toEqual(owner);
  });

  it("keeps a pinned thread across focus and environment changes, then resumes following", () => {
    useThreadContextSidebarStore.setState(useThreadContextSidebarStore.getInitialState());
    const store = useThreadContextSidebarStore.getState();
    store.selectView("artifacts");
    store.toggleMaximized();
    store.selectView("list");
    expect(useThreadContextSidebarStore.getState()).toMatchObject({
      open: true,
      view: "list",
      maximized: true,
    });
    store.selectView("list");
    expect(useThreadContextSidebarStore.getState()).toMatchObject({ open: false, view: "list" });
    store.toggle();
    expect(useThreadContextSidebarStore.getState()).toMatchObject({
      open: true,
      view: "list",
      maximized: true,
    });
    store.restore();
    expect(useThreadContextSidebarStore.getState().maximized).toBe(false);
    store.pin(child);
    const other = { environmentId: EnvironmentId.make("remote"), threadId: owner.threadId };
    expect(
      selectContextThread(other, null, [], useThreadContextSidebarStore.getState().pinned),
    ).toEqual(child);
    store.pin(null);
    expect(
      selectContextThread(other, null, [], useThreadContextSidebarStore.getState().pinned),
    ).toEqual(other);
    expect(selectContextThread(null, null, [], null)).toBeNull();
  });
});
