import type { OrchestratorMcpThreadProgress, OrchestrationV2Run, RunId } from "@t3tools/contracts";

/** Summarizes a thread without treating a reply as final while its work remains open. */
export function summarizeThreadProgress(input: {
  readonly run: Pick<OrchestrationV2Run, "id" | "status"> | undefined;
  readonly reply: { readonly text: string; readonly runId: RunId } | null;
  readonly continuationPending: boolean;
  readonly pendingRequestCount: number;
  readonly hasPendingQuestion: boolean;
  readonly pendingBackgroundWorkCount: number;
}): OrchestratorMcpThreadProgress {
  const active =
    input.run !== undefined &&
    (input.run.status === "queued" ||
      input.run.status === "preparing" ||
      input.run.status === "starting" ||
      input.run.status === "running" ||
      input.run.status === "waiting");
  const status = input.hasPendingQuestion
    ? "question"
    : input.pendingRequestCount > 0
      ? "waiting"
      : active || input.continuationPending
        ? "working"
        : input.pendingBackgroundWorkCount > 0
          ? "waiting"
          : "done";
  return {
    status,
    pendingRequestCount: input.pendingRequestCount,
    pendingBackgroundWorkCount: input.pendingBackgroundWorkCount,
    lastAssistantReply:
      input.reply === null
        ? null
        : {
            runId: input.reply.runId,
            text: input.reply.text.slice(0, 500),
            truncated: input.reply.text.length > 500,
            isFinal: status === "done",
          },
  };
}
