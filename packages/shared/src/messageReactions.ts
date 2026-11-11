import type { TurnOrigin } from "@t3tools/contracts";

export type MessageReaction = "ack" | "replied" | "info";

/** Reads one boundary reaction line, preserving the original text on malformed input. */
export function parseAssistantReactions(text: string, knownIndexes?: ReadonlySet<number>) {
  const unchanged = () => ({ reactions: new Map<number, MessageReaction>(), body: text });
  if (!text.includes("[react")) return unchanged();
  const lines = text.trim().split(/\r?\n/);
  const candidates = lines.flatMap((line, index) =>
    line.trim().startsWith("[react") ? [index] : [],
  );
  const position = candidates[0];
  if (
    position === undefined ||
    candidates.length !== 1 ||
    (position !== 0 && position !== lines.length - 1)
  )
    return unchanged();
  const match = /^\[react[ \t]+([^\r\n]+)\]$/.exec(lines[position]!.trim());
  if (!match) return unchanged();
  const reactions = new Map<number, MessageReaction>();
  const seen = new Set<number>();
  for (const token of match[1]!.trim().split(/[ \t]+/)) {
    const entry = /^(\d+):(ack|replied|info)$/.exec(token);
    if (!entry) return unchanged();
    const index = Number(entry[1]);
    if (!Number.isSafeInteger(index) || seen.has(index)) return unchanged();
    seen.add(index);
    if (index > 0 && (knownIndexes === undefined || knownIndexes.has(index))) {
      const reaction = entry[2];
      if (reaction === "ack" || reaction === "replied" || reaction === "info")
        reactions.set(index, reaction);
    }
  }
  return {
    reactions,
    body: lines
      .filter((_, index) => index !== position)
      .join("\n")
      .trim(),
  };
}

/** Whether a final assistant message contains only reactions and no user-facing body. */
export function isReactionOnlyAssistantText(text: string): boolean {
  const parsed = parseAssistantReactions(text);
  return parsed.reactions.size > 0 && parsed.body.length === 0;
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
