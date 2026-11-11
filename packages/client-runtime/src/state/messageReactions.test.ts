import {
  EnvironmentId,
  MessageId,
  NodeId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type TurnOrigin,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { inputMessageReactions } from "./messageReactions.ts";

const now = DateTime.makeUnsafe("2026-11-11T00:00:00.000Z");
const run = {
  id: RunId.make("run"),
  rootNodeId: NodeId.make("root"),
  userMessageId: MessageId.make("first"),
} satisfies Pick<OrchestrationV2Run, "id" | "rootNodeId" | "userMessageId">;
const origin = {
  kind: "thread",
  threadId: ThreadId.make("sender"),
  environmentId: EnvironmentId.make("local"),
  title: "Sender",
  event: "message",
  reply: "not expected",
} satisfies TurnOrigin;
function base(id: string, ordinal: number) {
  return {
    id: TurnItemId.make(id),
    threadId: ThreadId.make("recipient"),
    runId: run.id,
    nodeId: run.rootNodeId,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  };
}
function incoming(id: string, from: TurnOrigin = origin) {
  return {
    ...base(id, 0),
    type: "user_message",
    messageId: MessageId.make(id),
    text: "Update",
    origin: from,
    inputIntent: "turn_start",
    createdBy: "agent",
    creationSource: "server",
    attachments: [],
  } satisfies OrchestrationV2TurnItem;
}
function final(text: string) {
  return {
    ...base("final", 10),
    type: "assistant_message",
    messageId: MessageId.make("reply"),
    text,
    streaming: false,
  } satisfies OrchestrationV2TurnItem;
}

describe("inputMessageReactions", () => {
  it("uses delivery order, includes other origin indexes, and falls back to the single input", () => {
    const first = incoming("first");
    const second = incoming("second");
    const wake = incoming("wake", { kind: "system", event: "wake" });
    const user = incoming("user", { kind: "user" });
    const items = [
      first,
      second,
      wake,
      user,
      final("[react 1:ack 2:ack 3:info 99:ack]\nCheck the decision."),
    ];
    const reactions = inputMessageReactions(
      [
        {
          ...run,
          inputMessageIds: [user.messageId, second.messageId, wake.messageId, first.messageId],
        },
      ],
      items,
    );
    expect(reactions.get(first.messageId)).toEqual({
      emoji: "ℹ",
      label: "Telling you",
      tooltip: "Telling you",
    });
    expect(reactions.get(second.messageId)?.label).toBe("Handled");
    expect([...reactions.keys()]).toEqual([second.messageId, first.messageId]);
    expect(
      inputMessageReactions([run], [first, final("[react 1:ack]")]).get(first.messageId)?.label,
    ).toBe("Handled");
    expect(
      inputMessageReactions(
        [{ ...run, inputMessageIds: [MessageId.make("missing"), second.messageId] }],
        [second, final("[react 1:ack 2:info]")],
      ).size,
    ).toBe(0);
  });

  it("keeps unverified reply claims and verifies matching sends in this run", () => {
    const message = incoming("first");
    const reply = final("[react 1:replied]");
    const send: OrchestrationV2TurnItem = {
      ...base("send", 2),
      type: "dynamic_tool",
      toolName: "mcp__t3-code__t3_thread_send",
      input: { threadId: "sender", message: "Answered" },
      output: {},
    };
    const unverified = inputMessageReactions([run], [message, reply]).get(message.messageId);
    expect(unverified).toMatchObject({ emoji: "↩", label: "Replied" });
    expect(unverified?.tooltip).toContain("unverified");
    expect(
      inputMessageReactions([run], [message, send, reply], [], EnvironmentId.make("local")).get(
        message.messageId,
      )?.tooltip,
    ).toBe("Replied");
    expect(
      inputMessageReactions([run], [message, send, reply], [], EnvironmentId.make("other")).get(
        message.messageId,
      )?.tooltip,
    ).toContain("unverified");
    expect(
      inputMessageReactions([run], [message, { ...send, status: "failed" }, reply]).get(
        message.messageId,
      )?.tooltip,
    ).toContain("unverified");
    expect(
      inputMessageReactions([run], [message, { ...send, runId: RunId.make("other") }, reply]).get(
        message.messageId,
      )?.tooltip,
    ).toContain("unverified");
  });

  it("uses the root final assistant text and ignores malformed or streaming reactions", () => {
    const message = incoming("first");
    const child: OrchestrationV2TurnItem = {
      ...final("[react 1:info]"),
      id: TurnItemId.make("child"),
      nodeId: NodeId.make("child"),
      ordinal: 20,
    };
    expect(
      inputMessageReactions([run], [message, final("[react 1:ack]"), child]).get(message.messageId)
        ?.label,
    ).toBe("Handled");
    expect(inputMessageReactions([run], [message, final("[react 1:nope]")]).size).toBe(0);
    const streaming = {
      ...final("[react 1:ack]"),
      type: "assistant_message" as const,
      streaming: true,
    };
    expect(inputMessageReactions([run], [message, streaming]).size).toBe(0);
  });
});
