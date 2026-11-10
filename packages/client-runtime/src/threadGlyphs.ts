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
  {
    name: "penguin",
    paths: [
      "M12 2C8 2 7 6 7 9C5 12 3 16 4 18C5 19 7 17 7 16C7 20 8 22 12 22S17 20 17 16C17 17 19 19 20 18C21 16 19 12 17 9C17 6 16 2 12 2Z",
    ],
  },
  {
    name: "turtle",
    paths: ["M2 16C2 9 7 5 12 5S19 9 19 14L22 11L23 14L20 17H17L16 19H13V17H8V19H5L4 17H2Z"],
  },
  {
    name: "duck",
    paths: [
      "M2 7L6 6C6 3 11 2 13 5C15 8 12 9 13 11C20 10 22 15 21 18C20 21 15 22 11 22C6 22 4 18 6 14C7 12 8 11 8 10C6 10 4 9 2 7Z",
    ],
  },
  {
    name: "bat",
    paths: [
      "M12 6L14 4L15 7C17 6 20 5 22 4C22 8 21 12 19 14C18 12 17 13 16 15C15 14 13 15 12 20C11 15 9 14 8 15C7 13 6 12 5 14C3 12 2 8 2 4C4 5 7 6 9 7L10 4Z",
    ],
  },
  {
    name: "crab",
    paths: [
      "M2 6C2 3 6 3 6 6L7 9C9 8 15 8 17 9L18 6C18 3 22 3 22 6C22 9 20 10 19 10C21 12 21 16 18 17L20 21H18L16 18H8L6 21H4L6 17C3 16 3 12 5 10C4 10 2 9 2 6Z",
    ],
  },
  {
    name: "shark",
    paths: [
      "M2 17C6 17 8 12 11 5C13 9 15 11 17 12C19 12 21 10 22 8C22 12 21 15 22 19C19 18 18 17 17 17C13 20 6 20 2 17Z",
    ],
  },
  {
    name: "paw",
    paths: [
      "M7.3 10A2.3 2.3 0 1 1 2.7 10A2.3 2.3 0 1 1 7.3 10",
      "M11.8 5.5A2.3 2.3 0 1 1 7.2 5.5A2.3 2.3 0 1 1 11.8 5.5",
      "M16.8 5.5A2.3 2.3 0 1 1 12.2 5.5A2.3 2.3 0 1 1 16.8 5.5",
      "M21.3 10A2.3 2.3 0 1 1 16.7 10A2.3 2.3 0 1 1 21.3 10",
      "M12 11C8 11 5 16 6 19C7 21 10 20 12 20S17 21 18 19C19 16 16 11 12 11Z",
    ],
  },
  {
    name: "spider",
    paths: [
      "M12 7C16 7 17 11 17 14C17 18 14 20 12 20S7 18 7 14C7 11 8 7 12 7Z",
      "M8 10L4 6L2 3",
      "M8 13L2 12",
      "M8 16L3 19L2 22",
      "M16 10L20 6L22 3",
      "M16 13L22 12",
      "M16 16L21 19L22 22",
    ],
  },
  {
    name: "sun",
    paths: [
      "M17 12A5 5 0 1 1 7 12A5 5 0 1 1 17 12",
      "M20 12L22.5 12",
      "M17.7 17.7L19.4 19.4",
      "M12 20L12 22.5",
      "M6.3 17.7L4.6 19.4",
      "M4 12L1.5 12",
      "M6.3 6.3L4.6 4.6",
      "M12 4L12 1.5",
      "M17.7 6.3L19.4 4.6",
    ],
  },
  {
    name: "raindrop",
    paths: ["M12 2C12 2 5 10 5 15C5 19 8 22 12 22S19 19 19 15C19 10 12 2 12 2Z"],
  },
  { name: "pine", paths: ["M12 2L17 9H15L19 15H14V22H10V15H5L9 9H7Z"] },
  {
    name: "cactus",
    paths: [
      "M9 22V5C9 2 14 2 14 5V9H16V7C16 5 20 5 20 7V11C20 13 18 14 16 14H14V22Z",
      "M9 17H7C5 17 4 16 4 14V11",
    ],
  },
  { name: "mushroom", paths: ["M2 12C2 6 7 3 12 3S22 6 22 12H16V20C16 22 8 22 8 20V12Z"] },
  { name: "wave", paths: ["M2 20C2 10 8 4 15 4C13 6 14 9 17 9C21 9 22 13 22 20Z"] },
  { name: "rainbow", paths: ["M2 20C2 10 6 4 12 4S22 10 22 20H17C17 14 15 10 12 10S7 14 7 20Z"] },
  { name: "snowflake", paths: ["M12 2V22", "M3.3 7L20.7 17", "M3.3 17L20.7 7"] },
  {
    name: "sprout",
    paths: [
      "M12 22V12",
      "M12 13C12 8 8 6 3 7C3 12 7 14 12 13Z",
      "M12 11C12 6 15 3 21 3C21 9 17 12 12 11Z",
    ],
  },
  { name: "rocket", paths: ["M12 2C16 5 17 9 16 14L19 18V21L15 19H9L5 21V18L8 14C7 9 8 5 12 2Z"] },
  {
    name: "sparkle",
    paths: ["M12 2C13 8 16 11 22 12C16 13 13 16 12 22C11 16 8 13 2 12C8 11 11 8 12 2Z"],
  },
  {
    name: "burst",
    paths: [
      "M12 1L14.5 6L19.8 4.2L18 9.5L23 12L18 14.5L19.8 19.8L14.5 18L12 23L9.5 18L4.2 19.8L6 14.5L1 12L6 9.5L4.2 4.2L9.5 6Z",
    ],
  },
  {
    name: "anchor",
    paths: [
      "M14 4.5A2 2 0 1 1 10 4.5A2 2 0 1 1 14 4.5",
      "M12 7V21",
      "M8 11H16",
      "M3 15C3 19 7 21 12 21S21 19 21 15",
    ],
  },
  { name: "shield", paths: ["M12 2L20 5V11C20 16 16 20 12 22C8 20 4 16 4 11V5Z"] },
  { name: "crown", paths: ["M3 18L2 7L8 12L12 4L16 12L22 7L21 18Z"] },
  {
    name: "umbrella",
    paths: [
      "M2 12C2 6 7 3 12 3S22 6 22 12C20 10.5 18 10.5 16.5 12C15 10.5 13 10.5 12 12C11 10.5 9 10.5 7.5 12C6 10.5 4 10.5 2 12Z",
      "M12 12V19C12 21 9 21 9 19",
    ],
  },
  { name: "paperplane", paths: ["M2 11L22 2L16 21L11 14Z", "M11 14L22 2"] },
  {
    name: "trophy",
    paths: [
      "M7 3H17V10C17 13 15 15 12 15C9 15 7 13 7 10Z",
      "M7 5H3C3 9 5 10 7 10",
      "M17 5H21C21 9 19 10 17 10",
      "M12 15V19",
      "M8 21H16",
    ],
  },
  { name: "house", paths: ["M2 12L12 3L22 12H19V21H14V15H10V21H5V12Z"] },
  {
    name: "compass",
    paths: ["M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12", "M16 8L13.5 13.5L8 16L10.5 10.5Z"],
  },
  {
    name: "apple",
    paths: [
      "M12 7C9 5 4 6 4 12C4 17 8 22 12 20C16 22 20 17 20 12C20 6 15 5 12 7Z",
      "M12 7C12 5 13 3 15 2",
    ],
  },
  {
    name: "cherry",
    paths: [
      "M9 17A4 4 0 1 1 1 17A4 4 0 1 1 9 17",
      "M23 16A4 4 0 1 1 15 16A4 4 0 1 1 23 16",
      "M5 13C6 8 9 5 14 3",
      "M19 12C18 8 17 6 14 3",
    ],
  },
  {
    name: "coffee",
    paths: ["M4 6H17V16C17 19 15 21 12 21H9C6 21 4 19 4 16Z", "M17 8H19C21 8 21 13 19 13H17"],
  },
  {
    name: "strawberry",
    paths: [
      "M3 8C3 5 8 5 12 6C16 5 21 5 21 8C21 13 15 21 12 22C9 21 3 13 3 8Z",
      "M12 6L9 2",
      "M12 6L15 2",
    ],
  },
  { name: "hexagon", paths: ["M12 2L21 7V17L12 22L3 17V7Z"] },
  {
    name: "target",
    paths: [
      "M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12",
      "M17.5 12A5.5 5.5 0 1 1 6.5 12A5.5 5.5 0 1 1 17.5 12",
      "M13 12A1 1 0 1 1 11 12A1 1 0 1 1 13 12",
    ],
  },
  {
    name: "spade",
    paths: [
      "M12 2C16 8 21 10 21 15C21 18 18 19 16 18C16 20 17 21 18 22H6C7 21 8 20 8 18C6 19 3 18 3 15C3 10 8 8 12 2Z",
    ],
  },
  { name: "cube", paths: ["M12 2L21 7V17L12 22L3 17V7Z", "M3 7L12 12L21 7", "M12 12V22"] },
  {
    name: "car",
    paths: [
      "M2 17V12L5 11L8 6H16L19 11L22 12V17H2Z",
      "M9.5 18A2.5 2.5 0 1 1 4.5 18A2.5 2.5 0 1 1 9.5 18",
      "M19.5 18A2.5 2.5 0 1 1 14.5 18A2.5 2.5 0 1 1 19.5 18",
    ],
  },
  { name: "sailboat", paths: ["M11 3V15H3Z", "M13 6L21 15H13Z", "M2 18H22L19 22H5Z"] },
  {
    name: "airplane",
    paths: [
      "M12 2C13 2 14 3 14 5V9L22 14V16L14 14V19L17 21V22L12 21L7 22V21L10 19V14L2 16V14L10 9V5C10 3 11 2 12 2Z",
    ],
  },
  {
    name: "helicopter",
    paths: [
      "M4 14C4 10 8 8 12 8H16L21 6V9L17 11C17 14 14 17 10 17C6 17 4 16 4 14Z",
      "M6 5H18",
      "M12 5V8",
      "M5 20H14",
      "M9 17V20",
    ],
  },
  {
    name: "ghost",
    paths: ["M12 2C7 2 5 6 5 10V22L8 19L10 22L12 19L14 22L16 19L19 22V10C19 6 17 2 12 2Z"],
  },
  {
    name: "skull",
    paths: [
      "M12 2C6 2 3 6 3 11C3 14 5 15 6 16V20H18V16C19 15 21 14 21 11C21 6 18 2 12 2Z",
      "M10 11A2 2 0 1 1 6 11A2 2 0 1 1 10 11",
      "M18 11A2 2 0 1 1 14 11A2 2 0 1 1 18 11",
      "M12 16V20",
    ],
  },
  { name: "wizardhat", paths: ["M12 2L17 14C20 15 22 17 22 19H2C2 17 4 15 7 14Z"] },
  { name: "castle", paths: ["M3 21V6H7V9H9.5V6H14.5V9H17V6H21V21H15V15C15 12 9 12 9 15V21Z"] },
  { name: "sword", paths: ["M12 2L15 5V15H19V18H14V22H10V18H5V15H9V5Z"] },
  { name: "crystalball", paths: ["M19 10A7 7 0 1 1 5 10A7 7 0 1 1 19 10", "M6 21L8 16H16L18 21Z"] },
  {
    name: "wing",
    paths: [
      "M2 4C10 2 18 6 22 14C18 13 17 14 16 16C15 14 13 14 11 16C10 14 8 14 6 16C5 10 3 8 2 4Z",
    ],
  },
  { name: "potion", paths: ["M9 2H15V8L20 19C21 21 20 22 18 22H6C4 22 3 21 4 19L9 8Z"] },
] as const satisfies ReadonlyArray<{ name: string; paths: readonly string[] }>;

const NEON_COLORS = [
  { name: "Blue", dark: "#70dcff", light: "#087da3" },
  { name: "Orange", dark: "#fdba74", light: "#b75c17" },
  { name: "Mint", dark: "#70f0bf", light: "#087c59" },
  { name: "Pink", dark: "#ff94d7", light: "#b1267d" },
  { name: "Violet", dark: "#c6a5ff", light: "#7442bd" },
  { name: "Yellow", dark: "#f5df79", light: "#8a7010" },
  { name: "Red", dark: "#ff5a52", light: "#e9170c" },
  { name: "Teal", dark: "#12e2d5", light: "#0b847c" },
  { name: "Coral", dark: "#fb8c6a", light: "#da3c0b" },
  { name: "Cobalt", dark: "#477eff", light: "#346df4" },
  { name: "Mauve", dark: "#c99cb3", light: "#a85d82" },
  { name: "Lime", dark: "#a8ee2f", light: "#547f0a" },
  { name: "Amber", dark: "#ffa100", light: "#a06808" },
  { name: "Indigo", dark: "#6f52ff", light: "#5c3df5" },
  { name: "Green", dark: "#44e459", light: "#138622" },
  { name: "Magenta", dark: "#f15af6", light: "#ce0bd5" },
  { name: "Emerald", dark: "#11d473", light: "#0b8447" },
  { name: "Rose", dark: "#fb6089", light: "#e90c47" },
  { name: "Azure", dark: "#52a3ff", light: "#0c73e9" },
  { name: "Copper", dark: "#ca7849", light: "#ae6032" },
  { name: "Purple", dark: "#b855f1", light: "#ac39ef" },
  { name: "Sand", dark: "#d1bb94", light: "#8f713d" },
  { name: "Silver", dark: "#b7c0cd", light: "#647790" },
  { name: "Olive", dark: "#cdd22d", light: "#777a1a" },
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
