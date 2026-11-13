import { describe, expect, it } from "vite-plus/test";
import {
  isReactionOnlyAssistantText,
  numberedTurnOrigins,
  parseAssistantReactions,
} from "./messageReactions.ts";

describe("parseAssistantReactions", () => {
  it.each([
    ["[react 1:ack 3:ack]\nA decision is needed.", "A decision is needed."],
    ["A decision is needed.\n[react 1:ack 3:ack]", "A decision is needed."],
    ["[react 1:ack 3:ack]\r\nA decision is needed.", "A decision is needed."],
    [" \n\t[react 1:ack 3:ack]\n \t", ""],
  ])("strips a boundary line from %j", (text, body) => {
    expect(parseAssistantReactions(text)).toEqual({
      reactions: new Map([
        [1, "ack"],
        [3, "ack"],
      ]),
      body,
    });
    expect(isReactionOnlyAssistantText(text)).toBe(body === "");
  });

  it.each([
    "[quiet]",
    "",
    "[react]",
    "[react 1:done]",
    "[react 1:info]\nA decision is needed.",
    "[react 1:replied]",
    "[react 1:ack 2:info]\nA decision is needed.",
    "[react 1:ack 1:ack]",
    "[react 1:ack] body",
    "Before\n[react 1:ack]\nAfter",
    "`[react 1:ack]`",
    "[react 1:ack]\n[react 2:info]",
    "[react 1:ack]\0hidden",
    "[react 9007199254740992:ack]",
  ])("preserves malformed or ordinary text verbatim: %j", (text) => {
    expect(parseAssistantReactions(text)).toEqual({ reactions: new Map(), body: text });
    expect(isReactionOnlyAssistantText(text)).toBe(false);
  });

  it("ignores indexes outside the delivered origins without losing the body", () => {
    expect(parseAssistantReactions("[react 0:ack 1:ack 99:ack]\nDecision.", new Set([1]))).toEqual({
      reactions: new Map([[1, "ack"]]),
      body: "Decision.",
    });
  });
});

it("numbers delivered origins without counting user text or native control commands", () => {
  const messages = [
    { id: "user", text: "Do it", origin: { kind: "user" } },
    { id: "first", text: "Done", origin: { kind: "system", event: "notice" } },
    { id: "legacy", text: "More user text" },
    { id: "compact", text: "/compact", origin: { kind: "system", event: "command" } },
    { id: "second", text: "Decide", origin: { kind: "wake", detail: "review" } },
  ] as const;
  expect(numberedTurnOrigins(messages).map(({ message, index }) => [message.id, index])).toEqual([
    ["first", 1],
    ["second", 2],
  ]);
});
