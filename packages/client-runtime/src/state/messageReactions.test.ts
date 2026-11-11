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
import { compactDynamicToolOutput } from "@t3tools/shared/toolOutput";
import {
  buildMessageRows,
  messageResponseRowsEqual,
  type MessageResponseRow,
} from "./messageReactions.ts";

function inputMessageReactions(...args: Parameters<typeof buildMessageRows>) {
  return new Map(
    buildMessageRows(...args).flatMap((row) =>
      row.kind === "incoming" && row.reaction
        ? [[row.message.messageId, row.reaction] as const]
        : [],
    ),
  );
}

const now = DateTime.makeUnsafe("2026-11-11T00:00:00.000Z");
const run = {
  id: RunId.make("run"),
  rootNodeId: NodeId.make("root"),
  userMessageId: MessageId.make("first"),
  status: "completed",
} satisfies Pick<OrchestrationV2Run, "id" | "rootNodeId" | "userMessageId" | "status">;
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
      final("[react 1:ack 2:ack 99:ack]\nCheck the decision."),
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
      label: "Told you",
      tooltip: "Told you",
    });
    expect(reactions.get(second.messageId)?.label).toBe("Handled");
    expect([...reactions.keys()]).toEqual([first.messageId, second.messageId, wake.messageId]);
    expect(
      inputMessageReactions([run], [first, final("[react 1:ack]")]).get(first.messageId)?.label,
    ).toBe("Handled");
    for (const status of ["running", "interrupted", "failed", "cancelled"] as const) {
      expect(
        inputMessageReactions([{ ...run, status }], [first, final("I'll check that.")]).size,
      ).toBe(0);
    }
    expect(
      inputMessageReactions(
        [{ ...run, inputMessageIds: [MessageId.make("missing"), second.messageId] }],
        [second, final("[react 1:ack 2:info]")],
      ).size,
    ).toBe(0);
  });

  it("derives replies only from successful explicit sends in the same run", () => {
    const message = incoming("first");
    const reply = final("");
    const send: OrchestrationV2TurnItem = {
      ...base("send", 2),
      type: "dynamic_tool",
      toolName: "mcp__t3-code__t3_thread_send",
      input: { threadId: "sender", message: "Answered", replyTo: 1 },
      output: { replyToMessageId: message.messageId },
    };
    expect(inputMessageReactions([run], [message, reply]).size).toBe(0);
    expect(
      inputMessageReactions([run], [message, send, reply], [], EnvironmentId.make("local")).get(
        message.messageId,
      )?.tooltip,
    ).toBe("Replied");
    expect(inputMessageReactions([run], [message, send]).get(message.messageId)?.emoji).toBe("↩");
    expect(
      inputMessageReactions([{ ...run, status: "running" }], [message, send]).get(message.messageId)
        ?.emoji,
    ).toBe("↩");
    expect(
      inputMessageReactions([run], [message, send, final("[react 1:ack]")]).get(message.messageId)
        ?.emoji,
    ).toBe("↩");
    expect(
      inputMessageReactions([run], [message, { ...send, status: "failed" }, reply]).get(
        message.messageId,
      )?.tooltip,
    ).toBeUndefined();
    expect(
      inputMessageReactions([run], [message, { ...send, runId: RunId.make("other") }, reply]).get(
        message.messageId,
      )?.tooltip,
    ).toBeUndefined();
    expect(
      inputMessageReactions(
        [run],
        [
          message,
          { ...send, input: { threadId: "sender", message: "Unlinked" }, output: {} },
          reply,
        ],
      ).size,
    ).toBe(0);
    expect(
      inputMessageReactions(
        [run],
        [
          message,
          { ...send, output: { isError: true, replyToMessageId: message.messageId } },
          reply,
        ],
      ).size,
    ).toBe(0);
    expect(
      inputMessageReactions([run], [message, { ...send, status: "running" }, reply]).size,
    ).toBe(0);
  });

  it("derives told-you from a final body without requiring a reaction line", () => {
    const message = incoming("first");
    expect(
      inputMessageReactions([run], [message, final("Please approve the deletion.")]).get(
        message.messageId,
      )?.label,
    ).toBe("Told you");
    expect(inputMessageReactions([run], [message, final(" \n ")]).size).toBe(0);
    expect(
      inputMessageReactions(
        [run],
        [message, final("[react 1:ack]\nPlease approve the deletion.")],
      ).get(message.messageId)?.label,
    ).toBe("Handled");
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
    expect(
      inputMessageReactions([run], [message, final("[react 1:nope]")]).get(message.messageId)
        ?.label,
    ).toBe("Told you");
    const streaming = {
      ...final("[react 1:ack]"),
      type: "assistant_message" as const,
      streaming: true,
    };
    expect(inputMessageReactions([run], [message, streaming]).size).toBe(0);
  });
});

describe("buildMessageRows", () => {
  it("places only linked same-turn replies and told-you lines under incoming rows", () => {
    const first = incoming("first");
    const second = incoming("second");
    const laterRun = {
      ...run,
      id: RunId.make("later"),
      userMessageId: MessageId.make("later-input"),
    };
    const send = (
      id: string,
      ordinal: number,
      replyToMessageId?: string,
    ): OrchestrationV2TurnItem => ({
      ...base(id, ordinal),
      type: "dynamic_tool",
      toolName: "t3_thread_send",
      input: {
        threadId: "sender",
        message: `${id}\nMore detail`,
        ...(replyToMessageId ? { replyTo: 1 } : {}),
      },
      output: compactDynamicToolOutput(replyToMessageId ? { replyToMessageId } : {}),
    });
    const linked = send("linked", 4, first.messageId);
    const unlinked = send("unlinked", 3);
    const later = { ...send("later", 12, first.messageId), runId: laterRun.id };
    const rows = buildMessageRows(
      [{ ...run, inputMessageIds: [first.messageId, second.messageId] }, laterRun],
      [first, second, unlinked, linked, final("Decision needed.\n\nFull paragraph."), later],
    );
    expect(rows.map((row) => row.kind)).toEqual([
      "incoming",
      "reply-line",
      "incoming",
      "to-you",
      "outgoing",
      "outgoing",
    ]);
    expect(rows[1]).toMatchObject({
      parentMessageId: first.messageId,
      item: { id: linked.id },
      message: { body: "linked\nMore detail" },
    });
    expect(rows[3]).toMatchObject({
      parentMessageId: second.messageId,
      messageId: MessageId.make("reply"),
      body: "Decision needed.\n\nFull paragraph.",
    });
    expect(rows.filter((row) => row.kind === "outgoing").map((row) => row.item.id)).toEqual([
      unlinked.id,
      later.id,
    ]);
    expect(rows[0]).toMatchObject({ reaction: { emoji: "↩" } });
    expect(rows[2]).toMatchObject({ reaction: { emoji: "ℹ" } });
    const merged = [first, second].map((message) => ({
      ...run,
      id: RunId.make(`merged:${message.messageId}`),
      userMessageId: message.messageId,
      inputMessageIds: [message.messageId],
      status: "cancelled" as const,
      mergedIntoRunId: run.id,
    }));
    expect(
      buildMessageRows(
        [{ ...run, inputMessageIds: [first.messageId, second.messageId] }, laterRun, ...merged],
        [first, second, unlinked, linked, final("Decision needed.\n\nFull paragraph."), later],
      ),
    ).toEqual(rows);
    const responses = rows.filter(
      (row): row is MessageResponseRow => row.kind === "reply-line" || row.kind === "to-you",
    );
    const rebuilt = buildMessageRows(
      [{ ...run, inputMessageIds: [first.messageId, second.messageId] }, laterRun],
      [first, second, unlinked, linked, final("Decision needed.\n\nFull paragraph."), later],
    );
    expect(
      messageResponseRowsEqual(
        responses,
        rebuilt.filter(
          (row): row is MessageResponseRow => row.kind === "reply-line" || row.kind === "to-you",
        ),
      ),
    ).toBe(true);
    expect(
      messageResponseRowsEqual(
        responses,
        responses.map((row) =>
          row.kind === "to-you" ? { ...row, body: "Changed decision" } : row,
        ),
      ),
    ).toBe(false);
  });
});
