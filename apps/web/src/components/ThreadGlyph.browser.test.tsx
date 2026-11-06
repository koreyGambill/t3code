import "../index.css";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { ThreadGlyph } from "./ThreadGlyph";

it("traces a working glyph in its contrasting color without repainting React", async () => {
  // The glyph and shared visibility observer have no navigation.
  await using screen = await render(
    <ThreadGlyph threadId="motion-proof" working className="size-10" />,
    { router: false },
  );
  const glyph = screen.getByRole("img", { name: /working/ }).element();
  const trace = glyph.querySelector(".thread-glyph-trace")!;
  await vi.waitFor(() => expect(getComputedStyle(trace).animationPlayState).toBe("running"));
  const animation = trace.getAnimations()[0]!;
  expect(animation).toBeDefined();
  animation.pause();
  animation.currentTime = 0;
  const beginning = getComputedStyle(trace).strokeDashoffset;
  animation.currentTime = 800;
  expect(getComputedStyle(trace).strokeDashoffset).not.toBe(beginning);
  expect(getComputedStyle(trace).stroke).not.toBe(getComputedStyle(glyph).stroke);
});
