import {
  type ChatAttachment,
  type TurnOrigin,
  type ChatFileAttachment,
  type GuestMessageAttribution,
  type OrchestrationMessageContext,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2IdleCompaction,
  type OrchestrationV2UserMessageInputIntent,
  type ScheduledTaskId,
} from "@t3tools/contracts";
import {
  isAttachmentOnlyBootstrapPrompt,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import { filePreviewKind } from "@t3tools/shared/filePreview";
import { imageMimeType } from "@t3tools/shared/image";
import { videoMimeType } from "@t3tools/shared/video";

/** The working row while T3 Code's own compaction runs. */
export const IDLE_COMPACTING_LABELS = {
  beforeCacheExpires: "Compacting before the cache expires…",
  onReturn: "Compacting…",
} satisfies Record<OrchestrationV2IdleCompaction, string>;

/** Leads the finished compaction's token counts, in place of "Context compacted". */
export const IDLE_COMPACTION_TITLES = {
  beforeCacheExpires: "Context automatically compacted before cache expiry",
  onReturn: "Context compacted before sending",
} satisfies Record<OrchestrationV2IdleCompaction, string>;

export function resolveUserMessageFileCards(message: {
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly context?: OrchestrationMessageContext | undefined;
}): ReadonlyArray<ChatFileAttachment> | null {
  const files = message.attachments.filter(
    (attachment): attachment is ChatFileAttachment =>
      attachment.type === "file" &&
      imageMimeType(attachment) === null &&
      videoMimeType(attachment) === null &&
      filePreviewKind(attachment) !== "audio",
  );
  if (files.length === 0 || files.length !== message.attachments.length) return null;
  const fileIds = new Set(files.map((file) => file.id));
  const remaining = replaceComposerContextReferences(message.text, (reference) => {
    const record = message.context?.records.find((item) => item.contextId === reference.contextId);
    return reference.kind === "file" &&
      record?.kind === "file" &&
      "attachmentId" in record &&
      fileIds.has(record.attachmentId)
      ? ""
      : reference.label || reference.kind;
  });
  return remaining.trim() === "" ? files : null;
}

export function resolveUserMessagePresentation(message: {
  readonly id?: string;
  readonly role: string;
  readonly text: string;
  readonly origin?: TurnOrigin | undefined;
  readonly createdBy?: OrchestrationV2Actor;
  readonly creationSource?: OrchestrationV2CreationSource;
  readonly senderThreadId?: string | undefined;
  readonly delegatedCompletion?: { readonly taskIds: ReadonlyArray<string> } | undefined;
  readonly scheduledTaskId?: ScheduledTaskId | undefined;
  readonly context?: { readonly guest?: GuestMessageAttribution | undefined } | undefined;
}): {
  readonly text: string;
  readonly sender?: Extract<TurnOrigin, { readonly threadId: unknown }>;
  readonly attribution: "automation" | "agent" | "t3code" | "guest" | null;
  readonly scheduledTaskId: ScheduledTaskId | undefined;
  /** Set when `attribution` is "guest". */
  readonly guestName?: string;
} {
  if (message.role !== "user") {
    return { text: message.text, attribution: null, scheduledTaskId: undefined };
  }
  // The stored text names the guest for the agent; people see the guest's own words.
  const guest = message.context?.guest;
  if (guest !== undefined) {
    return {
      text: guest.text,
      attribution: "guest",
      scheduledTaskId: undefined,
      guestName: guest.name,
    };
  }
  const origin = message.origin;
  if (origin !== undefined) {
    const sender = "threadId" in origin ? origin : undefined;
    return {
      text: isAttachmentOnlyBootstrapPrompt(message.text) ? "" : message.text,
      attribution:
        origin.kind === "user"
          ? null
          : origin.kind === "scheduled-task"
            ? "automation"
            : sender
              ? "agent"
              : "t3code",
      scheduledTaskId: message.scheduledTaskId,
      ...(sender ? { sender } : {}),
    };
  }
  if (message.scheduledTaskId !== undefined) {
    return {
      text: message.text,
      attribution: "automation",
      scheduledTaskId: message.scheduledTaskId,
    };
  }
  return {
    // The agent needs words to start a turn; people sent only the attachments.
    text: isAttachmentOnlyBootstrapPrompt(message.text) ? "" : message.text,
    attribution:
      message.createdBy !== "agent"
        ? null
        : message.creationSource === "server" &&
            message.senderThreadId === undefined &&
            message.delegatedCompletion === undefined
          ? "t3code"
          : "agent",
    scheduledTaskId: undefined,
  };
}

type GroupableUserMessage = Parameters<typeof resolveUserMessagePresentation>[0] & {
  readonly inputIntent?: OrchestrationV2UserMessageInputIntent;
};

export function resolveUserMessageGrouping(
  message: GroupableUserMessage | undefined,
  previous: GroupableUserMessage | undefined,
  next: GroupableUserMessage | undefined,
) {
  const isOwnMessage = (value: GroupableUserMessage | undefined) =>
    value?.role === "user" && resolveUserMessagePresentation(value).attribution === null;
  const isSteer = (value: GroupableUserMessage | undefined) =>
    value?.inputIntent === "steer" || value?.inputIntent === "promoted_queued_to_steer";
  const groupedWithPrevious = isOwnMessage(message) && isOwnMessage(previous);
  return {
    groupedWithPrevious,
    groupedWithNext: isOwnMessage(message) && isOwnMessage(next),
    continuesSteer: groupedWithPrevious && isSteer(message) && isSteer(previous),
  };
}

function senderOriginDetails(origin: Exclude<TurnOrigin, { kind: "user" }>) {
  switch (origin.kind) {
    case "thread":
      return {
        title: origin.title || "Thread",
        relationship: "peer thread",
        event: origin.event,
        noReply: origin.reply === "not expected",
      };
    case "subagent":
      return {
        title: origin.title || "Agent",
        relationship: "subagent",
        event: origin.event,
        noReply: false,
      };
    case "scheduled-task":
      return {
        title: origin.title,
        relationship: "scheduled task",
        event: "fired",
        noReply: false,
      };
    case "wake":
      return { title: "Wake", relationship: "T3 Code", event: "fired", noReply: false };
    case "system":
      return { title: "T3 Code", relationship: "T3 Code", event: origin.event, noReply: false };
  }
}

/** The first nonempty line used by collapsed message summaries. */
export function messageFirstLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0] ?? "";
}

export function senderCardDetails(origin: Exclude<TurnOrigin, { kind: "user" }>, text = "") {
  const details = senderOriginDetails(origin);
  const relationship =
    details.relationship === "peer thread"
      ? "peer"
      : details.relationship === "scheduled task"
        ? "schedule"
        : details.relationship;
  return {
    ...details,
    summary: [
      relationship,
      details.event === "message" ? "" : details.event,
      messageFirstLine(text),
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export function nonUserMessageOrigin(
  message: Parameters<typeof resolveUserMessagePresentation>[0],
): Exclude<TurnOrigin, { kind: "user" }> | null {
  if (message.origin !== undefined) return message.origin.kind === "user" ? null : message.origin;
  const presentation = resolveUserMessagePresentation(message);
  return presentation.attribution === "automation"
    ? { kind: "scheduled-task", title: "Automation" }
    : presentation.attribution === "agent" || presentation.attribution === "t3code"
      ? { kind: "system", event: "message" }
      : null;
}
