import { ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import {
  readThreadAttention,
  showThreadAttention,
  subscribeThreadAttention,
} from "./threadAttention";

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
    showThreadAttention(first);
    unsubscribe();
    expect(readThreadAttention()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    unsubscribe();
    vi.useRealTimers();
  }
});
