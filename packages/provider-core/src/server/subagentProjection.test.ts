import { describe, expect, it } from "vite-plus/test";

import { subagentThreadTitle, withExecutedModelNote } from "./subagentProjection.ts";

describe("subagentThreadTitle", () => {
  it("clips a long prompt without splitting a surrogate pair", () => {
    const title = (prompt: string) =>
      subagentThreadTitle({ parentTitle: "Parent", prompt, ordinal: 1 });

    expect(title(`${"a".repeat(68)}😀 and more work.`)).toBe(`${"a".repeat(68)}...`);
    expect(title(`${"a".repeat(67)}😀 and more work.`)).toBe(`${"a".repeat(67)}😀...`);
  });
});

it.each([
  ["[quiet]", "[quiet]"],
  [" \n[quiet]\n ", " \n[quiet]\n "],
  ["Done.", "Requested model requested; the provider reported running executed.\n\nDone."],
  [
    "Use [quiet] for silence.",
    "Requested model requested; the provider reported running executed.\n\nUse [quiet] for silence.",
  ],
])("preserves quiet result semantics when the executed model differs: %s", (result, expected) => {
  expect(withExecutedModelNote(result, "requested", "executed")).toBe(expected);
});
