import { describe, expect, it } from "vite-plus/test";

import { nextThreadGlyphSeed, resolveThreadGlyph } from "./threadGlyphs";

describe("threadGlyphs", () => {
  it("retains a thread's identity across repeated resolutions and saved rerolls", () => {
    const original = resolveThreadGlyph("thread-a");
    const rerolledSeed = nextThreadGlyphSeed("thread-a");
    const rerolled = resolveThreadGlyph("thread-a", rerolledSeed);
    for (let index = 0; index < 10; index += 1) {
      resolveThreadGlyph(`other-thread-${index}`, index);
      expect(resolveThreadGlyph("thread-a", 0)).toEqual(original);
      expect(resolveThreadGlyph("thread-a", rerolledSeed)).toEqual(rerolled);
    }
    expect(original).toMatchObject({ colorName: "Blue", color: "#70dcff", lightColor: "#087da3" });
  });

  it("changes shape and color on every reroll, including UInt32 wraparound", () => {
    for (const threadId of ["", "thread-a", "thread-b", "🧵"]) {
      for (const seed of [0, 1, 29, 30, 65535, 4294967294, 4294967295]) {
        const nextSeed = nextThreadGlyphSeed(threadId, seed);
        expect(Number.isInteger(nextSeed)).toBe(true);
        expect(nextSeed).toBeGreaterThanOrEqual(0);
        expect(nextSeed).toBeLessThanOrEqual(4294967295);
        const previous = resolveThreadGlyph(threadId, seed);
        const next = resolveThreadGlyph(threadId, nextSeed);
        expect(next.name).not.toBe(previous.name);
        expect(next.colorName).not.toBe(previous.colorName);
      }
    }
  });

  it("normalizes malformed seeds without losing a renderable glyph", () => {
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(resolveThreadGlyph("thread-a", seed)).toEqual(resolveThreadGlyph("thread-a", 0));
      expect(nextThreadGlyphSeed("thread-a", seed)).toBe(1);
    }
    expect(resolveThreadGlyph("thread-a", 4294967296)).toEqual(resolveThreadGlyph("thread-a", 0));
  });
});
