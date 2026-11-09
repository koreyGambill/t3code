import { describe, expect, it, vi } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { createOfflineOutbox, type OfflineSubmission } from "./offlineOutbox.ts";

const environmentId = EnvironmentId.make("primary");
const serverId = EnvironmentId.make("server");
const submission = (): OfflineSubmission => ({
  environmentId,
  serverId,
  input: {
    commandId: CommandId.make("command"),
    threadId: ThreadId.make("thread"),
    message: {
      messageId: MessageId.make("message"),
      origin: { kind: "user" },
      role: "user",
      text: "hello",
      attachments: [],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    dispatchMode: "queue",
  },
});

describe("offline outbox", () => {
  it("retains one snapshot per thread, supports cancellation, and never sends a cancelled draft", async () => {
    const outbox = createOfflineOutbox();
    expect(outbox.enqueue(submission())).toBe(true);
    expect(outbox.enqueue(submission())).toBe(false);
    expect(outbox.getSnapshot()[0]?.status).toBe("queued");
    outbox.cancel(CommandId.make("command"));
    const send = vi.fn();
    await outbox.reconnect(environmentId, serverId, 1, send);
    expect(send).not.toHaveBeenCalled();
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it("retries an unacknowledged send only on a new connection with identical IDs", async () => {
    const outbox = createOfflineOutbox();
    outbox.enqueue(submission());
    const send = vi.fn().mockResolvedValueOnce("disconnected").mockResolvedValue("sent");
    await outbox.reconnect(environmentId, serverId, 1, send);
    await outbox.reconnect(environmentId, serverId, 1, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.getSnapshot()[0]).toMatchObject({ status: "queued", attempted: true });
    await outbox.reconnect(environmentId, serverId, 2, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0].input).toEqual(send.mock.calls[1]?.[0].input);
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it("does not overlap sends and remembers a reconnect arriving before the failed request settles", async () => {
    const outbox = createOfflineOutbox();
    outbox.enqueue(submission());
    let reply!: (value: "disconnected") => void;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            reply = resolve;
          }),
      )
      .mockResolvedValue("sent");
    const sending = outbox.reconnect(environmentId, serverId, 1, send);
    expect(outbox.getSnapshot()[0]?.status).toBe("sending");
    outbox.cancel(CommandId.make("command"));
    const reconnected = outbox.reconnect(environmentId, serverId, 2, send);
    reply("disconnected");
    await Promise.all([sending, reconnected]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it("refuses a changed server identity and keeps server permission refusals visible without retrying", async () => {
    const outbox = createOfflineOutbox();
    outbox.enqueue(submission());
    const send = vi.fn().mockResolvedValue({ error: "This connection cannot change threads." });
    await outbox.reconnect(environmentId, EnvironmentId.make("different-server"), 1, send);
    expect(send).not.toHaveBeenCalled();
    expect(outbox.getSnapshot()[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("different environment"),
    });
    outbox.cancel(CommandId.make("command"));
    outbox.enqueue(submission());
    await outbox.reconnect(environmentId, serverId, 2, send);
    await outbox.reconnect(environmentId, serverId, 3, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.getSnapshot()[0]).toMatchObject({
      status: "failed",
      error: "This connection cannot change threads.",
    });
  });

  it("rejects offline attachments and new-thread bootstraps", () => {
    const outbox = createOfflineOutbox();
    expect(() =>
      outbox.enqueue({
        ...submission(),
        input: { ...submission().input, bootstrap: { runSetupScript: true } },
      }),
    ).toThrow("existing threads");
    expect(() =>
      outbox.enqueue({
        ...submission(),
        input: {
          ...submission().input,
          message: {
            ...submission().input.message,
            attachments: [
              {
                type: "image",
                name: "image.png",
                mimeType: "image/png",
                sizeBytes: 1,
                dataUrl: "data:image/png;base64,AA==",
              },
            ],
          },
        },
      }),
    ).toThrow("without attachments");
  });
});
