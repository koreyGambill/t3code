import type {
  EnvironmentId,
  MessageId,
  OrchestrationV2ExecutionNode,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { numberedTurnOrigins, parseAssistantReactions } from "@t3tools/shared/messageReactions";
import { outgoingT3Message, type OutgoingT3Message } from "../t3ToolSummary.ts";

export interface InputMessageReaction {
  readonly emoji: string;
  readonly label: string;
  readonly tooltip: string;
}

type InputMessage = Extract<OrchestrationV2TurnItem, { type: "user_message" }>;
type SendItem = Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>;
type MessageRun = Pick<
  OrchestrationV2Run,
  "id" | "rootNodeId" | "inputMessageIds" | "userMessageId"
>;

export type MessageRow =
  | {
      readonly kind: "incoming";
      readonly message: InputMessage;
      readonly reaction: InputMessageReaction | undefined;
    }
  | {
      readonly kind: "reply-line";
      readonly parentMessageId: MessageId;
      readonly item: SendItem;
      readonly message: OutgoingT3Message;
    }
  | {
      readonly kind: "to-you";
      readonly parentMessageId: MessageId;
      readonly messageId: MessageId;
      readonly body: string;
    }
  | { readonly kind: "outgoing"; readonly item: SendItem; readonly message: OutgoingT3Message };

export type MessageResponseRow = Extract<MessageRow, { kind: "reply-line" | "to-you" }>;

/** Retains settled response rows while unrelated turn items stream. */
export function messageResponseRowsEqual(
  left: ReadonlyArray<MessageResponseRow>,
  right: ReadonlyArray<MessageResponseRow>,
): boolean {
  return (
    left.length === right.length &&
    right.every((row, index) => {
      const before = left[index]!;
      return (
        row === before ||
        (row.parentMessageId === before.parentMessageId &&
          (row.kind === "reply-line" && before.kind === "reply-line"
            ? row.item === before.item && row.message.environmentId === before.message.environmentId
            : row.kind === "to-you" &&
              before.kind === "to-you" &&
              row.messageId === before.messageId &&
              row.body === before.body))
      );
    })
  );
}

/** The first nonempty line used in compact message rows. */
export function messageFirstLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0] ?? "";
}

/** Keeps unlinked sends chronological and groups explicit same-turn replies with their input. */
export function buildMessageRows(
  runs: ReadonlyArray<MessageRun>,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  nodes: ReadonlyArray<OrchestrationV2ExecutionNode> = [],
  environmentId?: EnvironmentId,
): MessageRow[] {
  const messages = new Map(
    items.flatMap((item) =>
      item.type === "user_message" ? [[item.messageId, item] as const] : [],
    ),
  );
  const byRun = new Map<OrchestrationV2Run["id"], OrchestrationV2TurnItem[]>();
  const outgoing = new Map<SendItem["id"], Extract<MessageRow, { kind: "outgoing" }>>();
  for (const item of items) {
    if (item.runId !== null) {
      const entries = byRun.get(item.runId) ?? [];
      entries.push(item);
      byRun.set(item.runId, entries);
    }
    if (item.type !== "dynamic_tool") continue;
    const message = outgoingT3Message(item.toolName ?? undefined, {
      input: item.input,
      output: item.output,
      outcome:
        item.status === "completed"
          ? "completed"
          : item.status === "failed"
            ? "failed"
            : "unfinished",
    });
    if (message)
      outgoing.set(item.id, {
        kind: "outgoing",
        item,
        message: { ...message, environmentId: message.environmentId ?? environmentId },
      });
  }
  const roots = new Map(nodes.map((node) => [node.id, node.rootNodeId]));
  const reactions = new Map<MessageId, InputMessageReaction>();
  const children = new Map<MessageId, MessageRow[]>();
  const attached = new Set<SendItem["id"]>();
  for (const run of runs) {
    const runItems = byRun.get(run.id) ?? [];
    const final = runItems
      .filter(
        (item) =>
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
    for (const { message, index } of numbered) {
      const replies: MessageRow[] = [];
      for (const item of runItems) {
        const send = outgoing.get(item.id);
        if (
          !send ||
          send.item.status !== "completed" ||
          send.message.event === "failed" ||
          send.message.replyToMessageId !== message.messageId
        )
          continue;
        replies.push({ ...send, kind: "reply-line", parentMessageId: message.messageId });
        attached.add(item.id);
      }
      const label =
        replies.length > 0
          ? "Replied"
          : parsed.reactions.has(index)
            ? "Handled"
            : parsed.body.trim()
              ? "Told you"
              : null;
      if (label)
        reactions.set(message.messageId, {
          emoji: label === "Replied" ? "↩" : label === "Handled" ? "👍" : "ℹ",
          label,
          tooltip: label,
        });
      if (label === "Told you" && final?.type === "assistant_message")
        replies.push({
          kind: "to-you",
          parentMessageId: message.messageId,
          messageId: final.messageId,
          body: parsed.body,
        });
      children.set(message.messageId, replies);
    }
  }
  return items.flatMap((item): MessageRow[] => {
    if (item.type === "user_message" && item.origin && item.origin.kind !== "user")
      return [
        { kind: "incoming", message: item, reaction: reactions.get(item.messageId) },
        ...(children.get(item.messageId) ?? []),
      ];
    const send = outgoing.get(item.id);
    return send && !attached.has(item.id) ? [send] : [];
  });
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
