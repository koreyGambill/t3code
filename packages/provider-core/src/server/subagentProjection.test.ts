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
  ["[react 1:ack]", "[react 1:ack]"],
  [
    "[react 1:ack]\nDone.",
    "Requested model requested; the provider reported running executed.\n\nDone.",
  ],
  ["Done.", "Requested model requested; the provider reported running executed.\n\nDone."],
  [
    "Ordinary result.",
    "Requested model requested; the provider reported running executed.\n\nOrdinary result.",
  ],
])("annotates result text when the executed model differs: %s", (result, expected) => {
  expect(withExecutedModelNote(result, "requested", "executed")).toBe(expected);
});
