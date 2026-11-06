const THREAD_GLYPHS = [
  {
    name: "bear",
    paths: ["M5 8C1 6 3 2 6 3L8 5Q12 3 16 5L18 3C21 2 23 6 19 8C22 14 19 21 12 21S2 14 5 8Z"],
  },
  { name: "heart", paths: ["M12 21C9 18 2 13 2 7C2 1 9 1 12 6C15 1 22 1 22 7C22 13 15 18 12 21Z"] },
  {
    name: "rabbit",
    paths: ["M7 12C3 4 5 1 7 3L11 10C11 2 14 1 15 3L15 11C23 14 21 22 12 22C3 22 1 16 7 12Z"],
  },
  { name: "monkey", paths: ["M5 9C-1 7 0 16 5 16C6 23 18 23 19 16C24 16 25 7 19 9C18 0 6 0 5 9Z"] },
  { name: "cat", paths: ["M4 12L3 3L9 7Q12 6 15 7L21 3L20 12C24 23 0 23 4 12Z"] },
  { name: "fox", paths: ["M3 3L10 7H14L21 3L20 13L12 22L4 13Z"] },
  {
    name: "dog",
    paths: [
      "M7 6C4 0 1 8 2 14Q3 17 6 12L7 19Q12 23 17 19L18 12Q21 17 22 14C23 8 20 0 17 6Q12 3 7 6Z",
    ],
  },
  { name: "owl", paths: ["M4 3L9 6H15L20 3L19 10C23 18 17 22 12 22S1 18 5 10Z"] },
  { name: "fish", paths: ["M7 12L2 6V18L7 12C11 4 18 4 22 12C18 20 11 20 7 12Z"] },
  { name: "whale", paths: ["M4 11C4 3 17 2 18 12L22 9L21 16C21 22 2 23 2 14L4 11Z"] },
  {
    name: "butterfly",
    paths: ["M12 11C3-3-2 6 6 13C-1 19 8 25 12 15C16 25 25 19 18 13C26 6 21-3 12 11Z"],
  },
  { name: "snail", paths: ["M6 16C0 7 5 2 11 3C18 4 19 13 15 17H19L21 12L23 13L22 20H4L2 17Z"] },
  { name: "bird", paths: ["M2 13L8 12C6 5 9 1 13 3L18 7L22 8L18 11C18 20 9 22 4 17L2 13Z"] },
  { name: "mouse", paths: ["M7 10C-1 9 1 1 6 3L10 7H14L18 3C23 1 25 9 17 10L16 17L12 22L8 17Z"] },
  {
    name: "elephant",
    paths: ["M7 4C-1 1 1 19 7 17L9 15V20C9 23 15 23 15 20V15L17 17C23 19 25 1 17 4Q12 2 7 4Z"],
  },
  { name: "frog", paths: ["M4 10C0 6 3 1 7 4L10 7H14L17 4C21 1 24 6 20 10C26 22-2 22 4 10Z"] },
  {
    name: "octopus",
    paths: [
      "M5 12C0-1 24-1 19 12L22 17Q23 21 19 20L16 17V20Q15 24 12 20Q9 24 8 20V17L5 20Q1 21 2 17Z",
    ],
  },
  { name: "alien", paths: ["M12 2C-4 2 2 16 12 22C22 16 28 2 12 2Z"] },
  { name: "UFO", paths: ["M6 10C7 0 17 0 18 10L22 13Q24 15 20 17L16 19H8L4 17Q0 15 2 13Z"] },
  {
    name: "planet",
    paths: ["M19 12A7 7 0 1 1 5 12A7 7 0 1 1 19 12", "M5 11C-3 16 1 21 12 17C23 13 27 5 19 7"],
  },
  { name: "moon", paths: ["M19 3C8 1 1 10 6 18C10 24 19 22 22 16C12 19 8 9 19 3Z"] },
  { name: "star", paths: ["M12 2L15 8L22 10L17 15L18 22L12 18L6 22L7 15L2 10L9 8Z"] },
  { name: "comet", paths: ["M20 2L17 12C23 20 9 27 5 19C1 11 9 8 12 10Z", "M3 9L9 3"] },
  { name: "cloud", paths: ["M5 19C-1 19 0 10 6 10C5 0 19 0 19 10C25 9 26 19 20 19Z"] },
  { name: "lightning", paths: ["M14 2L3 14H11L9 22L21 9H13Z"] },
  { name: "mountain", paths: ["M2 21L9 4L14 13L17 8L22 21Z"] },
  { name: "leaf", paths: ["M3 21C-1 7 9 2 21 3C22 16 15 24 3 21Z"] },
  { name: "diamond", paths: ["M8 3H16L22 9L12 22L2 9Z"] },
  {
    name: "flower",
    paths: [
      "M12 6C5-4 0 5 6 10C-4 14 3 23 10 18C12 29 22 22 18 16C29 12 22 3 16 8C17 1 11-1 12 6Z",
    ],
  },
  {
    name: "flame",
    paths: ["M12 2C17 8 11 10 18 8C26 17 16 25 8 21C0 17 5 10 7 8C6 14 11 13 12 2Z"],
  },
] as const satisfies ReadonlyArray<{ name: string; paths: readonly string[] }>;

const NEON_COLORS = [
  { name: "Blue", dark: "#70dcff", light: "#087da3" },
  { name: "Orange", dark: "#fdba74", light: "#b75c17" },
  { name: "Mint", dark: "#70f0bf", light: "#087c59" },
  { name: "Pink", dark: "#ff94d7", light: "#b1267d" },
  { name: "Violet", dark: "#c6a5ff", light: "#7442bd" },
  { name: "Yellow", dark: "#f5df79", light: "#8a7010" },
];

function hashThreadId(threadId: string) {
  let hash = 2166136261;
  for (let index = 0; index < threadId.length; index += 1) {
    hash = Math.imul(hash ^ threadId.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number | undefined) {
  return (seed ?? 0) >>> 0;
}

/** Resolves a thread's stable outline and color, with an optional saved reroll count. */
export function resolveThreadGlyph(threadId: string, seed?: number) {
  const reroll = normalizeSeed(seed);
  const glyph = THREAD_GLYPHS[(hashThreadId(threadId) + reroll) % THREAD_GLYPHS.length]!;
  const paletteIndex = (hashThreadId(`color:${threadId}`) + reroll) % NEON_COLORS.length;
  const palette = NEON_COLORS[paletteIndex]!;
  const tracePalette = NEON_COLORS[paletteIndex ^ 1]!;
  return {
    ...glyph,
    colorName: palette.name,
    color: palette.dark,
    lightColor: palette.light,
    traceColor: tracePalette.dark,
    lightTraceColor: tracePalette.light,
  };
}

/** Advances the saved UInt32 seed, changing both outline and color. */
export function nextThreadGlyphSeed(_threadId: string, seed?: number) {
  return (normalizeSeed(seed) + 1) >>> 0;
}
