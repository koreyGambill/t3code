import "../index.css";
import { ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";
import { showThreadAttention } from "../threadAttention";
import { ThreadAttentionOverlay } from "./ThreadAttentionOverlay";

it("escapes a small pane, covers half the window and lets work continue until it disappears", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
  };
  await page.viewport(1100, 800);
  const onClick = vi.fn();
  // The overlay lives above routing and must escape a clipped pane.
  await using screen = await render(
    <div className="size-40 overflow-hidden">
      <button onClick={onClick}>Keep working</button>
      <ThreadAttentionOverlay />
    </div>,
    { router: false },
  );
  using _timers = fakeTimers();
  await act(() =>
    showThreadAttention({
      threadId: ThreadId.make("other-thread"),
      seed: 3,
      title: "Other thread",
    }),
  );
  const overlay = document.querySelector<HTMLElement>(".thread-attention-overlay")!;
  await vi.waitFor(() =>
    expect(overlay.textContent).toContain("Other thread needs your attention"),
  );
  const flash = overlay.querySelector<HTMLElement>(".thread-attention-flash")!;
  expect(overlay.parentElement).toBe(document.body);
  expect(overlay.getBoundingClientRect().width).toBe(window.innerWidth);
  expect(overlay.getBoundingClientRect().height).toBe(window.innerHeight);
  const area = parseFloat(flash.style.width) * parseFloat(flash.style.height);
  expect(area / (window.innerWidth * window.innerHeight)).toBeCloseTo(0.5, 2);
  await screen.getByRole("button", { name: "Keep working" }).click();
  expect(onClick).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTime(1000));
  await vi.waitFor(() => expect(document.querySelector(".thread-attention-overlay")).toBeNull());
});
