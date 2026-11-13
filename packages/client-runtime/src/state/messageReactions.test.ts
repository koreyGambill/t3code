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
import { buildMessageRows } from "./messageReactions.ts";

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
      kind: "info",
      label: "Told you",
      tooltip: "Told you",
    });
    expect(reactions.get(second.messageId)?.label).toBe("Handled");
    expect([...reactions.keys()]).toEqual([first.messageId, second.messageId, wake.messageId]);
    expect(
      inputMessageReactions([run], [first, final("[react 1:ack]")]).get(first.messageId)?.label,
    ).toBe("Handled");
    for (const status of [
      "running",
      "interrupted",
      "failed",
      "cancelled",
      "rolled_back",
    ] as const) {
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
      inputMessageReactions([run], [message, send, reply], []).get(message.messageId)?.tooltip,
    ).toBe("Replied");
    expect(inputMessageReactions([run], [message, send]).get(message.messageId)?.kind).toBe(
      "replied",
    );
    expect(
      inputMessageReactions([{ ...run, status: "running" }], [message, send]).get(message.messageId)
        ?.kind,
    ).toBe("replied");
    expect(
      inputMessageReactions([run], [message, send, final("[react 1:ack]")]).get(message.messageId)
        ?.kind,
    ).toBe("replied");
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
    // Haiku acked a decision request and still warned the user (2026-11-11); the body wins.
    expect(
      inputMessageReactions(
        [run],
        [message, final("[react 1:ack]\nPlease approve the deletion.")],
      ).get(message.messageId)?.label,
    ).toBe("Told you");
    const second = { ...incoming("second"), ordinal: 1 };
    const merged = { ...run, inputMessageIds: [message.messageId, second.messageId] };
    const rows = inputMessageReactions(
      [merged],
      [message, second, final("[react 1:ack]\nPlease approve the deletion.")],
    );
    expect(rows.get(message.messageId)?.label).toBe("Handled");
    expect(rows.get(second.messageId)?.label).toBe("Told you");
  });

  it("treats a reply-expected message answered in the body as replied", () => {
    const question = incoming("first", { ...origin, reply: "expected" });
    expect(
      inputMessageReactions([run], [question, final("Use staging.")]).get(question.messageId)
        ?.label,
    ).toBe("Replied");
    expect(
      inputMessageReactions([run], [question, final("[react 1:ack]")]).get(question.messageId)
        ?.label,
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
  it("keeps incoming reaction chips without duplicating sends or the assistant body", () => {
    const first = incoming("first");
    const second = incoming("second");
    const send: OrchestrationV2TurnItem = {
      ...base("send", 2),
      type: "dynamic_tool",
      toolName: "t3_thread_send",
      input: { threadId: "sender", message: "Answered", replyTo: 1 },
      output: { replyToMessageId: first.messageId },
    };
    const runs = [{ ...run, inputMessageIds: [first.messageId, second.messageId] }];
    const items = [first, second, send, final("Decision needed.")];
    const rows = buildMessageRows(runs, items);
    expect(rows).toEqual([
      {
        kind: "incoming",
        message: first,
        reaction: { kind: "replied", label: "Replied", tooltip: "Replied" },
      },
      {
        kind: "incoming",
        message: second,
        reaction: { kind: "info", label: "Told you", tooltip: "Told you" },
      },
    ]);
    const merged = [first, second].map((message) => ({
      ...run,
      id: RunId.make(`merged:${message.messageId}`),
      userMessageId: message.messageId,
      inputMessageIds: [message.messageId],
      status: "cancelled" as const,
      mergedIntoRunId: run.id,
    }));
    expect(buildMessageRows([...runs, ...merged], items)).toEqual(rows);
  });
});
