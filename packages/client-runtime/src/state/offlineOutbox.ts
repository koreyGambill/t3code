import type { CommandId, EnvironmentId } from "@t3tools/contracts";
import type { StartThreadTurnInput } from "../operations/commands.ts";

export interface OfflineSubmission {
  readonly environmentId: EnvironmentId;
  readonly serverId: EnvironmentId;
  readonly input: StartThreadTurnInput & { readonly commandId: CommandId };
}

export interface OfflineOutboxEntry extends OfflineSubmission {
  readonly status: "queued" | "sending" | "failed";
  readonly attempted: boolean;
  readonly error: string | null;
}

export type OfflineSendResult = "sent" | "disconnected" | { readonly error: string };
type Send = (submission: OfflineSubmission) => Promise<OfflineSendResult>;

/** In-memory submissions, retried by connection signals with the original command and message IDs. */
export function createOfflineOutbox() {
  let entries: ReadonlyArray<OfflineOutboxEntry> = [];
  const listeners = new Set<() => void>();
  const connections = new Map<
    EnvironmentId,
    { serverId: EnvironmentId; generation: number; send: Send }
  >();
  const drains = new Map<EnvironmentId, Promise<void>>();
  const attempts = new Map<CommandId, number>();
  const publish = (next: ReadonlyArray<OfflineOutboxEntry>) => {
    entries = next;
    for (const listener of listeners) listener();
  };
  const update = (commandId: CommandId, change: Partial<OfflineOutboxEntry>) =>
    publish(
      entries.map((entry) =>
        entry.input.commandId === commandId ? { ...entry, ...change } : entry,
      ),
    );

  const drain = async (environmentId: EnvironmentId) => {
    while (true) {
      const connection = connections.get(environmentId);
      if (!connection) return;
      const entry = entries.find(
        (value) => value.environmentId === environmentId && value.status === "queued",
      );
      if (!entry || attempts.get(entry.input.commandId) === connection.generation) return;
      const commandId = entry.input.commandId;
      if (entry.serverId !== connection.serverId) {
        update(commandId, {
          status: "failed",
          error: "Connected to a different environment. Message was not sent.",
        });
        continue;
      }
      attempts.set(commandId, connection.generation);
      update(commandId, { status: "sending", attempted: true });
      let result: OfflineSendResult;
      try {
        result = await connection.send(entry);
      } catch (error) {
        result = {
          error: error instanceof Error ? error.message : "Could not send queued message.",
        };
      }
      if (result === "sent") {
        attempts.delete(commandId);
        publish(entries.filter((value) => value.input.commandId !== commandId));
      } else if (result === "disconnected") {
        update(commandId, { status: "queued" });
        if (connections.get(environmentId)?.generation === connection.generation) return;
      } else {
        update(commandId, { status: "failed", error: result.error });
      }
    }
  };

  return {
    getSnapshot: () => entries,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    enqueue: (submission: OfflineSubmission) => {
      if (submission.input.bootstrap || submission.input.message.attachments.length > 0) {
        throw new Error("Offline queue supports existing threads without attachments.");
      }
      if (
        entries.some(
          (entry) =>
            entry.environmentId === submission.environmentId &&
            entry.input.threadId === submission.input.threadId,
        )
      )
        return false;
      publish([...entries, { ...submission, status: "queued", attempted: false, error: null }]);
      return true;
    },
    cancel: (commandId: CommandId) => {
      const entry = entries.find((value) => value.input.commandId === commandId);
      if (entry?.status === "sending") return;
      attempts.delete(commandId);
      publish(entries.filter((value) => value.input.commandId !== commandId));
    },
    reconnect: (
      environmentId: EnvironmentId,
      serverId: EnvironmentId,
      generation: number,
      send: Send,
    ): Promise<void> => {
      connections.set(environmentId, { serverId, generation, send });
      const running = drains.get(environmentId);
      if (running) return running;
      const promise = drain(environmentId).finally(() => {
        drains.delete(environmentId);
      });
      drains.set(environmentId, promise);
      return promise;
    },
  };
}
