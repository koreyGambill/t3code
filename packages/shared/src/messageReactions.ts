import type { TurnOrigin } from "@t3tools/contracts";

export type MessageReaction = "ack";

/** Reads a leading reaction line or trailing tag, ignoring unsupported reaction kinds. */
export function parseAssistantReactions(text: string, knownIndexes?: ReadonlySet<number>) {
  const unchanged = () => ({ reactions: new Map<number, MessageReaction>(), body: text });
  if (!text.includes("[react")) return unchanged();
  const matches = [...text.matchAll(/\[react[ \t]+([^\]\r\n]+)\]/g)];
  const match = matches[0];
  if (!match || matches.length !== 1) return unchanged();
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const leadingLine = before.trim() === "" && /^[ \t]*(?:\r?\n|$)/.test(after);
  const trailingTag = after.trim() === "" && (before === "" || /\s$/.test(before));
  if (!leadingLine && !trailingTag) return unchanged();
  const reactions = new Map<number, MessageReaction>();
  const seen = new Set<number>();
  for (const token of match[1]!.trim().split(/[ \t]+/)) {
    const entry = /^(\d+):([a-z]+)$/.exec(token);
    if (!entry) return unchanged();
    const index = Number(entry[1]);
    if (!Number.isSafeInteger(index) || seen.has(index)) return unchanged();
    seen.add(index);
    if (
      entry[2] === "ack" &&
      index > 0 &&
      (knownIndexes === undefined || knownIndexes.has(index))
    ) {
      reactions.set(index, "ack");
    }
  }
  return {
    reactions,
    body: `${before}${after}`.trim(),
  };
}

/** Whether a final assistant message contains only reactions and no user-facing body. */
export function isReactionOnlyAssistantText(text: string): boolean {
  const parsed = parseAssistantReactions(text);
  return text.trim().length > 0 && parsed.body.length === 0;
}

/** Assigns rendered origins their turn-local indexes in delivery order. */
export function numberedTurnOrigins<
  T extends { readonly origin?: TurnOrigin | null | undefined; readonly text: string },
>(messages: readonly T[]) {
  return messages
    .filter(
      ({ origin, text }) =>
        origin != null &&
        origin.kind !== "user" &&
        !(
          origin.kind === "system" &&
          (origin.event === "command" || origin.event === "idle compaction") &&
          text.trim().toLowerCase() === "/compact"
        ),
    )
    .map((message, offset) => ({ message, index: offset + 1 }));
}
