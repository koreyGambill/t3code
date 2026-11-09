import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import {
  readThreadAttention,
  isThreadVisible,
  showThreadAttention,
  subscribeThreadAttention,
} from "./threadAttention";
import { applyTileAction, syncTileLayout } from "./threadTileLayout";

it("recognizes only displayed conversations across tiles, Focus, floating panes and documents", () => {
  const host = { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("host") };
  const child = { ...host, threadId: ThreadId.make("child") };
  const initial = syncTileLayout(undefined, [], ["side-chat:child", "files"], "files", true);
  const visible = (ref = host, layout = initial, documentVisible = true, route = host) =>
    isThreadVisible(ref, route, layout, documentVisible);
  expect(visible()).toBe(true);
  expect(visible(child)).toBe(false);
  expect(visible(host, initial, false)).toBe(false);
  expect(isThreadVisible(host, null, initial, true)).toBe(false);
  expect(visible({ ...host, environmentId: EnvironmentId.make("remote") })).toBe(false);
  const split = applyTileAction(initial, {
    type: "activate",
    groupId: "panels-group",
    tabId: "side-chat:child",
  });
  expect(visible(child, split)).toBe(true);
  const floating = applyTileAction(split, {
    type: "float-group",
    groupId: "panels-group",
    rect: { x: 0.5, y: 0, width: 0.4, height: 0.5 },
  });
  expect(visible(child, floating)).toBe(true);
  expect(visible(host, floating)).toBe(true);
  const maximized = applyTileAction(floating, { type: "maximize", groupId: "panels-group" });
  expect(visible(child, maximized)).toBe(true);
  expect(visible(host, maximized)).toBe(false);
  const focus = applyTileAction(split, { type: "focus-pair", groupId: "panels-group" });
  expect(visible(host, focus)).toBe(true);
  expect(visible(child, focus)).toBe(true);
  const focusLeft = applyTileAction(focus, { type: "focus-left", tabId: "files" });
  expect(visible(host, focusLeft)).toBe(false);
  expect(visible(child, focusLeft)).toBe(true);
  const selectedLeft = applyTileAction(focus, { type: "focus-left", tabId: "conversation" });
  const selectedMax = applyTileAction(selectedLeft, {
    type: "maximize",
    groupId: "focus-left-group",
  });
  expect(visible(host, selectedMax)).toBe(true);
  expect(visible(child, selectedMax)).toBe(false);
});

it("expires after one second and replaces a burst without an older timer clearing the new glyph", () => {
  vi.useFakeTimers();
  const unsubscribe = subscribeThreadAttention(vi.fn());
  try {
    const first = { threadId: ThreadId.make("first"), seed: 1, title: "First thread" };
    const second = { threadId: ThreadId.make("second"), seed: 2, title: "Second thread" };
    showThreadAttention(first);
    expect(readThreadAttention()).toMatchObject(first);
    vi.advanceTimersByTime(600);
    showThreadAttention(second);
    vi.advanceTimersByTime(400);
    expect(readThreadAttention()).toMatchObject(second);
    vi.advanceTimersByTime(599);
    expect(readThreadAttention()).toMatchObject(second);
    vi.advanceTimersByTime(1);
    expect(readThreadAttention()).toBeNull();
    showThreadAttention({ ...first, presentation: "pane" });
    vi.advanceTimersByTime(749);
    expect(readThreadAttention()).toMatchObject(first);
    vi.advanceTimersByTime(1);
    expect(readThreadAttention()).toBeNull();
    showThreadAttention(first);
    unsubscribe();
    expect(readThreadAttention()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    unsubscribe();
    vi.useRealTimers();
  }
});
