import type {
  MessageId,
  OrchestrationV2ExecutionNode,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { numberedTurnOrigins, parseAssistantReactions } from "@t3tools/shared/messageReactions";
import { outgoingT3Message } from "../t3ToolSummary.ts";

export interface InputMessageReaction {
  readonly kind: "ack" | "replied" | "info";
  readonly label: string;
  readonly tooltip: string;
}

type InputMessage = Extract<OrchestrationV2TurnItem, { type: "user_message" }>;
type MessageRun = Pick<
  OrchestrationV2Run,
  "id" | "rootNodeId" | "inputMessageIds" | "userMessageId" | "status" | "mergedIntoRunId"
>;

export interface MessageRow {
  readonly kind: "incoming";
  readonly message: InputMessage;
  readonly reaction: InputMessageReaction | undefined;
}

/** Derives incoming chips from successful same-turn replies and the final assistant body. */
export function buildMessageRows(
  runs: ReadonlyArray<MessageRun>,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  nodes: ReadonlyArray<OrchestrationV2ExecutionNode> = [],
): MessageRow[] {
  const messages = new Map(
    items.flatMap((item) =>
      item.type === "user_message" ? [[item.messageId, item] as const] : [],
    ),
  );
  const byRun = new Map<OrchestrationV2Run["id"], OrchestrationV2TurnItem[]>();
  for (const item of items) {
    if (item.runId !== null) {
      const entries = byRun.get(item.runId) ?? [];
      entries.push(item);
      byRun.set(item.runId, entries);
    }
  }
  const roots = new Map(nodes.map((node) => [node.id, node.rootNodeId]));
  const reactions = new Map<MessageId, InputMessageReaction>();
  for (const run of runs) {
    if (run.mergedIntoRunId !== undefined) continue;
    const runItems = byRun.get(run.id) ?? [];
    const final = runItems
      .filter(
        (item) =>
          run.status === "completed" &&
          item.type === "assistant_message" &&
          !item.streaming &&
          (item.nodeId === null ||
            item.nodeId === run.rootNodeId ||
            roots.get(item.nodeId) === run.rootNodeId),
      )
      .sort((a, b) => b.ordinal - a.ordinal)[0];
    const inputIds = run.inputMessageIds?.length
      ? run.inputMessageIds
      : run.userMessageId
        ? [run.userMessageId]
        : [];
    if (inputIds.some((id) => !messages.has(id))) continue;
    const numbered = numberedTurnOrigins(
      inputIds.flatMap((id) => {
        const message = messages.get(id);
        return message ? [message] : [];
      }),
    );
    const parsed = parseAssistantReactions(
      final?.type === "assistant_message" ? final.text : "",
      new Set(numbered.map(({ index }) => index)),
    );
    const repliedTo = new Set(
      runItems.flatMap((item) => {
        if (item.type !== "dynamic_tool" || item.status !== "completed") return [];
        const send = outgoingT3Message(item.toolName ?? undefined, {
          input: item.input,
          output: item.output,
          outcome: "completed",
        });
        return send?.event !== "failed" && send?.replyToMessageId ? [send.replyToMessageId] : [];
      }),
    );
    const hasBody = parsed.body.trim() !== "";
    // Acking every message while still writing to the user contradicts itself; the body wins.
    const acksTrusted = !hasBody || numbered.some(({ index }) => !parsed.reactions.has(index));
    for (const { message, index } of numbered) {
      // A reply-expected sender receives the turn's body as its reply.
      const forwardedReply =
        hasBody && message.origin?.kind === "thread" && message.origin.reply === "expected";
      const label =
        repliedTo.has(message.messageId) || forwardedReply
          ? "Replied"
          : acksTrusted && parsed.reactions.has(index)
            ? "Handled"
            : hasBody
              ? "Told you"
              : null;
      if (label)
        reactions.set(message.messageId, {
          kind: label === "Replied" ? "replied" : label === "Handled" ? "ack" : "info",
          label,
          tooltip: label,
        });
    }
  }
  return items.flatMap((item): MessageRow[] =>
    item.type === "user_message" && item.origin && item.origin.kind !== "user"
      ? [{ kind: "incoming", message: item, reaction: reactions.get(item.messageId) }]
      : [],
  );
}

/** Streaming assistant deltas cannot change a run's final reactions. */
export function reactionInputsUnchanged(
  before: ReadonlyArray<{ readonly item: OrchestrationV2TurnItem }>,
  after: ReadonlyArray<{ readonly item: OrchestrationV2TurnItem }>,
): boolean {
  return (
    before.length === after.length &&
    after.every((row, index) => {
      const previous = before[index]!;
      return (
        row === previous ||
        (row.item.type === "assistant_message" &&
          row.item.streaming &&
          previous.item.type === "assistant_message" &&
          previous.item.streaming)
      );
    })
  );
}
