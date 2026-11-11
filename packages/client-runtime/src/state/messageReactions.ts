import type {
  EnvironmentId,
  MessageId,
  OrchestrationV2ExecutionNode,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { numberedTurnOrigins, parseAssistantReactions } from "@t3tools/shared/messageReactions";
import { resolveT3McpMessageTool } from "@t3tools/shared/t3McpToolPresentation";
import { outgoingT3Message } from "../t3ToolSummary.ts";

export interface InputMessageReaction {
  readonly emoji: string;
  readonly label: string;
  readonly tooltip: string;
}

/** Map a run's numbered reactions back to its delivered messages, preserving origin numbering. */
export function inputMessageReactions(
  runs: ReadonlyArray<
    Pick<OrchestrationV2Run, "id" | "rootNodeId" | "inputMessageIds" | "userMessageId">
  >,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  nodes: ReadonlyArray<OrchestrationV2ExecutionNode> = [],
  environmentId?: EnvironmentId,
): ReadonlyMap<MessageId, InputMessageReaction> {
  const messages = new Map(
    items.flatMap((item) =>
      item.type === "user_message" ? [[item.messageId, item] as const] : [],
    ),
  );
  const byRun = new Map<OrchestrationV2Run["id"], OrchestrationV2TurnItem[]>();
  for (const item of items) {
    if (item.runId === null) continue;
    const entries = byRun.get(item.runId) ?? [];
    entries.push(item);
    byRun.set(item.runId, entries);
  }
  const roots = new Map(nodes.map((node) => [node.id, node.rootNodeId]));
  const result = new Map<MessageId, InputMessageReaction>();
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
    if (final?.type !== "assistant_message") continue;
    const inputIds = run.inputMessageIds?.length
      ? run.inputMessageIds
      : run.userMessageId
        ? [run.userMessageId]
        : [];
    if (inputIds.some((id) => !messages.has(id))) continue;
    const inputs = inputIds.flatMap((id) => {
      const message = messages.get(id);
      return message ? [message] : [];
    });
    const numbered = numberedTurnOrigins(inputs);
    const { reactions } = parseAssistantReactions(
      final.text,
      new Set(numbered.map(({ index }) => index)),
    );
    if (reactions.size === 0) continue;
    const replies = runItems.flatMap((item) => {
      if (
        item.type !== "dynamic_tool" ||
        resolveT3McpMessageTool(item.toolName ?? undefined) !== "t3_thread_send"
      )
        return [];
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
      return message && message.event !== "failed" ? [message] : [];
    });
    for (const { message, index } of numbered) {
      const reaction = reactions.get(index);
      const origin = message.origin;
      if (!reaction || !origin || !("threadId" in origin)) continue;
      const label =
        reaction === "ack" ? "Handled" : reaction === "replied" ? "Replied" : "Telling you";
      const verified = replies.some(
        (reply) =>
          reply.threadId === origin.threadId &&
          (reply.environmentId ?? environmentId) === origin.environmentId,
      );
      result.set(message.messageId, {
        emoji: reaction === "ack" ? "👍" : reaction === "replied" ? "↩" : "ℹ",
        label,
        tooltip:
          reaction === "replied" && !verified
            ? "Replied (unverified: no matching t3_thread_send in this run)"
            : label,
      });
    }
  }
  return result;
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
