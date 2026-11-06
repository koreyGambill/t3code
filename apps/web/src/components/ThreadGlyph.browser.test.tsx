import "../index.css";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { ThreadGlyph } from "./ThreadGlyph";

it("orbits two contrasting embers in opposite directions without repainting React", async () => {
  // The glyph and shared visibility observer have no navigation.
  await using screen = await render(
    <ThreadGlyph threadId="motion-proof" working className="size-10" />,
    { router: false },
  );
  const glyph = screen.getByRole("img", { name: /working/ }).element();
  const embers = glyph.querySelectorAll(".thread-glyph-ember");
  expect(embers.length).toBe(2);
  const trace = embers[0]!;
  await vi.waitFor(() => expect(getComputedStyle(trace).animationPlayState).toBe("running"));
  const animation = trace.getAnimations()[0]!;
  expect(animation).toBeDefined();
  animation.pause();
  animation.currentTime = 0;
  const beginning = getComputedStyle(trace).transform;
  animation.currentTime = 800;
  expect(getComputedStyle(trace).transform).not.toBe(beginning);
  const counter = embers[1]!.getAnimations()[0]!;
  counter.pause();
  counter.currentTime = 0;
  const counterStart = getComputedStyle(embers[1]!).transform;
  counter.currentTime = 800;
  expect(getComputedStyle(embers[1]!).transform).not.toBe(counterStart);
  expect(getComputedStyle(trace).color).not.toBe(getComputedStyle(glyph).color);
});
