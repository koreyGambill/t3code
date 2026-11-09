// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  MessageId,
  ReviewArtifact,
  ThreadWorkspace as Workspace,
  ThreadWorkspaceError,
  WORKSPACE_DEFAULT_GROUP_ID,
  type OrchestrationV2ConversationMessage,
  type ProjectId,
  type ThreadId,
  type WorkspaceSubmittedFeedback,
  type ThreadWorkspaceGetInput,
  type ThreadWorkspaceListWorkInput,
  type ThreadWorkspaceWorkEntry,
  type ThreadWorkspaceCounts,
  type ThreadWorkspaceSaveDraftInput,
  type ThreadWorkspaceSubmitInput,
  type ThreadWorkspaceMutateInput,
  type WorkspaceActor,
  type WorkspaceMutation,
  type WorkspaceQuery,
  type WorkspaceQueryResult,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { formatComposerContextHref } from "@t3tools/shared/composerContextReferences";
import {
  formatWorkspaceFeedback,
  readyWorkspaceFeedbackIds,
  workspaceDraftError,
} from "@t3tools/shared/workspaceFeedback";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { forkParked } from "../serverActivation.ts";
import * as TicketTracker from "../ticketTracker/TicketTracker.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { isForkableSourceRunStatus } from "../orchestration-v2/ThreadForkService.ts";
import { ProjectionStoreThreadNotFoundError } from "../orchestration-v2/ProjectionStore.ts";
import {
  changedItemIds,
  changedKeys,
  conflictingKeys,
  describeConflict,
  entityChangedSince,
  restamp,
  type WorkspaceStamps,
} from "./workspaceMerge.ts";

export class ThreadWorkspace extends Context.Service<
  ThreadWorkspace,
  {
    readonly get: (
      input: ThreadWorkspaceGetInput,
      options?: { readonly refreshTickets?: boolean },
    ) => Effect.Effect<Workspace, ThreadWorkspaceError>;
    readonly listWork: (
      input: ThreadWorkspaceListWorkInput,
    ) => Effect.Effect<ReadonlyArray<ThreadWorkspaceWorkEntry>, ThreadWorkspaceError>;
    readonly counts: (
      input: ThreadWorkspaceGetInput,
    ) => Effect.Effect<ThreadWorkspaceCounts, ThreadWorkspaceError>;
    readonly patch: (
      input: ThreadWorkspaceMutateInput,
    ) => Effect.Effect<Workspace, ThreadWorkspaceError>;
    readonly saveDraft: (
      input: ThreadWorkspaceSaveDraftInput,
    ) => Effect.Effect<Workspace, ThreadWorkspaceError>;
    readonly submit: (
      input: ThreadWorkspaceSubmitInput,
    ) => Effect.Effect<Workspace, ThreadWorkspaceError>;
    readonly query: (
      input: ThreadWorkspaceGetInput & WorkspaceQuery,
    ) => Effect.Effect<WorkspaceQueryResult, ThreadWorkspaceError>;
    /** `writerThreadId` is the calling agent's thread, used as verification provenance. */
    readonly mutate: (
      input: ThreadWorkspaceMutateInput,
      writerThreadId?: ThreadId | null,
    ) => Effect.Effect<WorkspaceQueryResult, ThreadWorkspaceError>;
    readonly importReview: (review: ReviewArtifact) => Effect.Effect<void, ThreadWorkspaceError>;
  }
>()("t3/threadWorkspace/ThreadWorkspace") {}

const LegacyWorkspace = Schema.Struct({
  threadId: Workspace.fields.threadId,
  revision: Workspace.fields.revision,
  actionItems: Workspace.fields.actionItems,
  designNotes: Schema.String,
  summaryNotes: Schema.String,
  updatedAt: Workspace.fields.updatedAt,
});
const PersistedWorkspace = Schema.Struct({
  formatVersion: Schema.Literal(2),
  workspace: Workspace,
  stamps: Schema.optional(Schema.Record(Schema.String, Schema.Int)),
});
const decodeWorkspace = Schema.decodeEffect(Schema.fromJsonString(PersistedWorkspace));
const decodeLegacy = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ formatVersion: Schema.Literal(1), workspace: LegacyWorkspace }),
  ),
);
const decodeReview = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ formatVersion: Schema.Literal(1), artifact: ReviewArtifact }),
  ),
);
const encodeWorkspace = Schema.encodeEffect(Schema.fromJsonString(PersistedWorkspace));
const encodeSnapshot = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeReviewOwner = Schema.decodeOption(
  Schema.fromJsonString(
    Schema.Struct({ artifact: Schema.Struct({ threadId: Workspace.fields.threadId }) }),
  ),
);
const decodeReviewThreadId = Schema.decodeOption(Schema.fromJsonString(Workspace.fields.threadId));
function legacyReviewOwner(contents: string) {
  const envelope = decodeReviewOwner(contents);
  if (Option.isSome(envelope)) return Option.some(envelope.value.artifact.threadId);
  const field = /(?<!\\)"threadId"\s*:\s*("(?:\\.|[^"\\])*")/.exec(contents)?.[1];
  return field === undefined ? Option.none() : decodeReviewThreadId(field);
}

const isMissingThread = Schema.is(ProjectionStoreThreadNotFoundError);
const isWorkspaceError = Schema.is(ThreadWorkspaceError);
const isProjectionError = Schema.is(Orchestrator.OrchestratorProjectionError);
const defaultGroup = { id: WORKSPACE_DEFAULT_GROUP_ID, parentId: null, title: "Ungrouped" };
const shortRef = (kind: string, id: string) =>
  `${kind}-${NodeCrypto.createHash("sha256").update(id).digest("hex").slice(0, 6).toUpperCase()}`;

export function emptyWorkspace(threadId: Workspace["threadId"]): Workspace {
  return {
    threadId,
    revision: 0,
    groups: [defaultGroup],
    questions: [],
    actionItems: [],
    designDocuments: [],
    agentWork: [],
    verifications: [],
    decisions: [],
    contextItems: [],
    designNotes: "",
    summaryNotes: "",
    childPreamble: "",
    relatedThreads: [],
    markAnnotations: [],
    userDraft: { questionAnswers: {}, actionNotes: {} },
    submissions: [],
    updatedAt: null,
  };
}

function validationError(workspace: Workspace): string | null {
  const groups = new Map(workspace.groups.map((group) => [group.id, group]));
  if (groups.size !== workspace.groups.length || !groups.has(WORKSPACE_DEFAULT_GROUP_ID))
    return "Groups need unique IDs and the default Ungrouped group.";
  for (const group of workspace.groups) {
    const seen = new Set([group.id]);
    let parentId = group.parentId;
    while (parentId !== null) {
      const parent = groups.get(parentId);
      if (!parent || seen.has(parentId))
        return "Groups must form a tree without missing parents or cycles.";
      seen.add(parentId);
      parentId = parent.parentId;
    }
  }
  if (groups.get(WORKSPACE_DEFAULT_GROUP_ID)?.parentId !== null)
    return "The default group must remain at the root.";
  const items = [
    ...workspace.questions,
    ...workspace.actionItems,
    ...workspace.designDocuments,
    ...workspace.agentWork,
    ...workspace.verifications,
    ...workspace.decisions,
    ...workspace.contextItems,
  ];
  if (new Set(items.map((item) => item.id)).size !== items.length)
    return "Workspace item IDs must be unique.";
  const refs = items.map((item) => item.ref).filter((ref) => ref !== undefined);
  if (new Set(refs).size !== refs.length) return "Workspace references must be unique.";
  const workIds = new Set(workspace.agentWork.map((item) => item.id));
  if (workspace.verifications.some((item) => !workIds.has(item.workId)))
    return "Remove an agent work item's verifications before removing the item.";
  if (
    items.some(
      (item) =>
        !groups.has(("groupId" in item ? item.groupId : undefined) ?? WORKSPACE_DEFAULT_GROUP_ID),
    )
  )
    return "Every item must belong to an existing group.";
  for (const question of workspace.questions) {
    const options = new Set(question.options.map((option) => option.id));
    if (
      options.size !== question.options.length ||
      question.recommendedOptionIds.some((id) => !options.has(id))
    )
      return "Question options and recommendations must refer to unique existing options.";
  }
  if (
    new Set(workspace.relatedThreads.map((thread) => thread.threadId)).size !==
    workspace.relatedThreads.length
  )
    return "Related threads must be unique.";
  if (
    new Set(workspace.markAnnotations.map((mark) => mark.url)).size !==
    workspace.markAnnotations.length
  )
    return "Mark URLs must be unique.";
  const contextMarkNames = workspace.markAnnotations.flatMap((mark) =>
    mark.contextSource === undefined || mark.name === undefined ? [] : [mark.name],
  );
  if (new Set(contextMarkNames).size !== contextMarkNames.length)
    return "Context mark names must be unique.";
  return null;
}
type SubmittedFeedback = typeof WorkspaceSubmittedFeedback.Type;
type IndexEntry = WorkspaceQueryResult["items"][number];

function indexEntries(
  workspace: Workspace,
  submitted: ReadonlyMap<string, SubmittedFeedback>,
): IndexEntry[] {
  const entry = (
    kind: string,
    item: {
      id: string;
      ref?: string | undefined;
      groupId?: string | undefined;
      title: string;
      ticket?: string | null | undefined;
      ticketData?: Workspace["agentWork"][number]["ticketData"];
    },
    status?: string,
  ): IndexEntry => ({
    id: item.id,
    ref: item.ref ?? "",
    groupId: item.groupId ?? WORKSPACE_DEFAULT_GROUP_ID,
    kind,
    title: item.title,
    ...(status === undefined ? {} : { status }),
    ...(item.ticket === undefined ? {} : { ticket: item.ticket }),
    ...(item.ticketData === undefined ? {} : { ticketData: item.ticketData }),
  });
  return [
    ...workspace.questions.map((item) =>
      entry("question", item, submitted.has(item.id) ? "answered" : "open"),
    ),
    ...workspace.actionItems.map((item) => entry("action", item, item.status)),
    ...workspace.designDocuments.map((item) => entry("design", item)),
    ...workspace.agentWork.map((item) => entry("work", item, item.status)),
    ...workspace.verifications.map((item) =>
      entry("verification", { ...item, title: `${item.method} ${item.result}` }, item.result),
    ),
    ...workspace.decisions.map((item) => entry("decision", item, item.status)),
    ...workspace.contextItems.map((item) => entry("context", item)),
  ];
}

function queryWorkspace(
  workspace: Workspace,
  query: WorkspaceQuery,
  submitted: ReadonlyMap<string, SubmittedFeedback> = new Map(),
): WorkspaceQueryResult {
  const section = query.section ?? "index";
  const entries = indexEntries(workspace, submitted);
  const statusOf = new Map(entries.map((item) => [item.id, item.status]));
  const wanted = (item: { id: string; ref?: string | undefined; groupId?: string | undefined }) =>
    (query.groupId === undefined || item.groupId === query.groupId) &&
    (query.itemIds === undefined ||
      query.itemIds.includes(item.id) ||
      (item.ref !== undefined && query.itemIds.includes(item.ref))) &&
    (query.status === undefined || query.status.includes(statusOf.get(item.id) ?? ""));
  const wantedWork = (item: Workspace["agentWork"][number]) =>
    wanted(item) && (query.userQa === undefined || query.userQa.includes(item.userQa));
  const withSubmitted = <T extends { id: string }>(item: T) => {
    const feedback = submitted.get(item.id);
    return feedback === undefined ? item : { ...item, submitted: feedback };
  };
  const work = workspace.agentWork.filter(wantedWork);
  const workIds = new Set(work.map((item) => item.id));
  const verifications = workspace.verifications.filter((item) => workIds.has(item.workId));
  if (section === "record")
    return {
      threadId: workspace.threadId,
      revision: workspace.revision,
      groups: [],
      items: [],
      summaryNotes: workspace.summaryNotes,
      childPreamble: workspace.childPreamble,
      agentWork: [
        ...work.filter((item) => item.status !== "done" && item.status !== "landed"),
        ...work.filter((item) => item.status === "done" || item.status === "landed").slice(-10),
      ],
      actionItems: workspace.actionItems
        .filter((item) => item.status !== "done" && wanted(item))
        .map(withSubmitted),
      decisions: workspace.decisions.filter(
        (decision) => decision.status !== "superseded" && wanted(decision),
      ),
      contextItems: workspace.contextItems.filter(wanted),
    };
  return {
    threadId: workspace.threadId,
    revision: workspace.revision,
    groups: workspace.groups,
    items: entries.filter(wanted),
    ...(section === "questions" || section === "all"
      ? {
          questions: workspace.questions.filter(wanted).map((item) => ({
            ...withSubmitted(item),
            status: submitted.has(item.id) ? ("answered" as const) : ("open" as const),
          })),
        }
      : {}),
    ...(section === "actions" || section === "all"
      ? { actionItems: workspace.actionItems.filter(wanted).map(withSubmitted) }
      : {}),
    ...(section === "design" || section === "all"
      ? { designDocuments: workspace.designDocuments.filter(wanted) }
      : {}),
    ...(section === "work" || section === "all" ? { agentWork: work, verifications } : {}),
    ...(section === "all"
      ? {
          decisions: workspace.decisions.filter(wanted),
          contextItems: workspace.contextItems.filter(wanted),
        }
      : {}),
    ...(section === "summary" || section === "all"
      ? { summaryNotes: workspace.summaryNotes, childPreamble: workspace.childPreamble }
      : {}),
    ...(section === "threads" || section === "all"
      ? { relatedThreads: workspace.relatedThreads }
      : {}),
    ...(section === "marks" || section === "all"
      ? { markAnnotations: workspace.markAnnotations }
      : {}),
  };
}

// Feedback counts as submitted once a sent user message carries the item's context record.
function submittedFeedback(
  threadId: Workspace["threadId"],
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): Map<string, SubmittedFeedback> {
  const result = new Map<string, SubmittedFeedback>();
  for (const message of messages) {
    if (message.role !== "user" || message.streaming) continue;
    for (const record of message.context?.records ?? []) {
      if (
        record.kind !== "thread" ||
        !("threadId" in record) ||
        record.threadId !== threadId ||
        !("workspaceItemId" in record) ||
        !record.workspaceItemId
      )
        continue;
      const href = `(${formatComposerContextHref("thread", record.contextId)})`;
      const at = message.text.indexOf(href);
      const start = at < 0 ? 0 : message.text.lastIndexOf("\n", at) + 1;
      const next = at < 0 ? -1 : message.text.indexOf("\n\n[", at);
      const text = message.text.slice(start, next < 0 ? undefined : next).trim();
      const previous = result.get(record.workspaceItemId);
      const submittedAt = DateTime.formatIso(message.createdAt);
      if (previous === undefined || previous.submittedAt <= submittedAt)
        result.set(record.workspaceItemId, {
          messageId: message.id,
          submittedAt,
          text: text.slice(0, 4_000),
        });
    }
  }
  return result;
}

function addReview(workspace: Workspace, review: ReviewArtifact): Workspace {
  const groups = [...workspace.groups];
  const questions = [...workspace.questions];
  const designDocuments = [...workspace.designDocuments];
  const questionAnswers = { ...workspace.userDraft.questionAnswers };
  for (const section of review.content.sections) {
    const groupId = `review-${review.id}-${section.id}`;
    if (!groups.some((group) => group.id === groupId))
      groups.push({ id: groupId, parentId: null, title: section.title });
    if (section.markdown && !designDocuments.some((document) => document.id === groupId))
      designDocuments.push({
        id: groupId,
        ref: shortRef("D", groupId),
        groupId,
        title: section.title,
        markdown: section.markdown,
        html: null,
      });
    for (const question of section.questions) {
      const id = `review-${review.id}-${question.id}`;
      if (questions.some((existing) => existing.id === id)) continue;
      questions.push({
        id,
        ref: shortRef("Q", id),
        groupId,
        title: question.prompt,
        details: question.context,
        options: question.options,
        recommendation: question.recommendation,
        recommendedOptionIds:
          question.recommendedOptionId === null ? [] : [question.recommendedOptionId],
        multiSelect: question.multiSelect,
      });
      const answer = review.draft.answers[question.id];
      const annotations = review.draft.annotations
        .filter((annotation) => annotation.questionId === question.id)
        .map(
          (annotation) => `${annotation.quote ? `“${annotation.quote}”\n` : ""}${annotation.body}`,
        );
      if (answer || annotations.length)
        questionAnswers[id] = {
          selectedOptionIds: answer?.selectedOptionIds ?? [],
          notes: [answer?.deferred ? "Previously deferred." : "", answer?.notes, ...annotations]
            .filter(Boolean)
            .join("\n\n"),
        };
    }
  }
  const reviewPrefix = `review-${review.id}-`;
  const extraNotes = [
    review.draft.notes,
    ...review.draft.annotations
      .filter((annotation) => annotation.questionId === null)
      .map(
        (annotation) => `${annotation.quote ? `“${annotation.quote}”\n` : ""}${annotation.body}`,
      ),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (extraNotes && !workspace.questions.some((question) => question.id.startsWith(reviewPrefix))) {
    let first = questions.find((question) => question.id.startsWith(reviewPrefix));
    if (!first) {
      const id = `${reviewPrefix}notes`;
      first = {
        id,
        ref: shortRef("Q", id),
        groupId: WORKSPACE_DEFAULT_GROUP_ID,
        title: `${review.content.title}: earlier notes`,
        details: review.content.summary,
        options: [],
        recommendedOptionIds: [],
        recommendation: "",
        multiSelect: false,
      };
      questions.push(first);
    }
    const answer = questionAnswers[first.id];
    questionAnswers[first.id] = {
      selectedOptionIds: answer?.selectedOptionIds ?? [],
      notes: [answer?.notes, extraNotes].filter(Boolean).join("\n\n"),
    };
  }
  return {
    ...workspace,
    groups,
    questions,
    designDocuments,
    userDraft: { ...workspace.userDraft, questionAnswers },
    submissions:
      review.lastSubmission !== null &&
      !workspace.submissions.some(
        (submission) =>
          submission.key === `legacy-review:${review.id}:${review.lastSubmission?.revision}`,
      )
        ? [
            ...workspace.submissions,
            {
              key: `legacy-review:${review.id}:${review.lastSubmission.revision}`,
              itemIds: questions
                .filter((question) => question.id.startsWith(reviewPrefix))
                .map((question) => question.id),
              messageId: review.lastSubmission.messageId,
              submittedAt: review.lastSubmission.submittedAt,
              markdown: review.lastSubmission.markdown,
            },
          ]
        : workspace.submissions,
  };
}

type ItemCollection =
  | "questions"
  | "actionItems"
  | "designDocuments"
  | "agentWork"
  | "verifications"
  | "decisions"
  | "contextItems";
const itemKinds = {
  question: ["questions", "Q"],
  action: ["actionItems", "A"],
  design: ["designDocuments", "D"],
  work: ["agentWork", "W"],
  verification: ["verifications", "V"],
  decision: ["decisions", "DC"],
  context: ["contextItems", "CX"],
} as const satisfies Record<string, readonly [ItemCollection, string]>;
const actionStatuses: ReadonlyArray<string> = ["open", "deferred", "done"];
const workStatuses: ReadonlyArray<string> = ["queued", "active", "blocked", "done", "landed"];
const decisionStatuses: ReadonlyArray<string> = ["proposed", "accepted", "superseded"];
const invalid = (message: string) => new ThreadWorkspaceError({ code: "invalid", message });

function buildItem(
  kind: keyof typeof itemKinds,
  id: string,
  ref: string,
  old: Record<string, unknown> | undefined,
  change: WorkspaceMutation,
  actor: WorkspaceActor,
  now: string,
  writerThreadId: ThreadId | null,
) {
  const pick = <K extends keyof WorkspaceMutation>(
    key: K,
    fallback: NonNullable<WorkspaceMutation[K]>,
  ) => change[key] ?? (old?.[key] as WorkspaceMutation[K]) ?? fallback;
  const groupId = pick("groupId", WORKSPACE_DEFAULT_GROUP_ID);
  if (kind === "question")
    return {
      id,
      ref,
      groupId,
      title: pick("title", "Question"),
      details: pick("details", ""),
      options: pick("options", []),
      recommendedOptionIds: pick("recommendedOptionIds", []),
      recommendation: pick("recommendation", ""),
      multiSelect: pick("multiSelect", false),
    };
  if (kind === "design")
    return {
      id,
      ref,
      groupId,
      title: pick("title", "Design"),
      markdown: pick("markdown", ""),
      html:
        change.html === undefined
          ? ((old?.html as string | null | undefined) ?? null)
          : change.html,
    };
  if (kind === "action") {
    const status = pick("status", "open");
    if (!actionStatuses.includes(status))
      return invalid("Action status must be open, deferred, or done.");
    return {
      id,
      ref,
      groupId,
      title: pick("title", "Action item"),
      details: pick("details", ""),
      status: status as "open" | "deferred" | "done",
    };
  }
  if (kind === "work") {
    const status = pick("status", "queued");
    if (!workStatuses.includes(status))
      return invalid("Agent work status must be queued, active, blocked, done, or landed.");
    const completedAt = (old?.completedAt as string | null | undefined) ?? null;
    const finished = status === "done" || status === "landed";
    const userQa = pick("userQa", "none");
    const title = pick("title", "Work");
    const source = pick("source", "");
    const ticket =
      change.ticket === undefined
        ? old?.ticket === undefined
          ? TicketTracker.inferTicketKey(title, source)
          : old.ticket
        : change.ticket;
    return {
      id,
      ref,
      title,
      ...(ticket === undefined ? {} : { ticket }),
      status: status as "queued" | "active" | "blocked" | "done" | "landed",
      remaining: pick("remaining", ""),
      source,
      details: pick("details", ""),
      changed: pick("changed", ""),
      qaSteps: pick("qaSteps", ""),
      checks: pick("checks", ""),
      userQa: finished && userQa === "none" ? "pending" : userQa,
      userQaNote: pick("userQaNote", ""),
      completedAt: finished ? (completedAt ?? now) : null,
      recordedByThreadId: old ? (old.recordedByThreadId as ThreadId | null) : writerThreadId,
    };
  }
  if (kind === "verification") {
    if (!change.workId && !old) return invalid("A verification needs workId.");
    return {
      id,
      ref,
      workId: (old?.workId as string | undefined) ?? change.workId!,
      verifier: pick("verifier", ""),
      method: pick("method", "executed"),
      details: pick("details", ""),
      testedRevision: pick("testedRevision", ""),
      result: pick("result", "pass"),
      gaps: pick("gaps", ""),
      evidence: pick("evidence", ""),
      at: (old?.at as string | undefined) ?? now,
      recordedBy: (old?.recordedBy as WorkspaceActor | undefined) ?? actor,
      recordedByThreadId: old ? (old.recordedByThreadId as ThreadId | null) : writerThreadId,
    };
  }
  if (kind === "decision") {
    const decidedBy = pick("decidedBy", actor);
    const status = pick("status", decidedBy === "user" ? "accepted" : "proposed");
    if (!decisionStatuses.includes(status))
      return invalid("Decision status must be proposed, accepted, or superseded.");
    return {
      id,
      ref,
      groupId,
      title: pick("title", "Decision"),
      rationale: pick("rationale", ""),
      decidedBy,
      status: status as "proposed" | "accepted" | "superseded",
      source: pick("source", ""),
      recordedBy: (old?.recordedBy as WorkspaceActor | undefined) ?? actor,
    };
  }
  return {
    id,
    ref,
    groupId,
    category: pick("category", "context"),
    title: pick("title", "Context"),
    details: pick("details", ""),
    source: pick("source", ""),
    recordedBy: (old?.recordedBy as WorkspaceActor | undefined) ?? actor,
  };
}

// Edits replace items in place so concurrent writers keep a stable order; new items append.
function applyChanges(
  current: Workspace,
  input: ThreadWorkspaceMutateInput,
  actor: WorkspaceActor,
  stamps: WorkspaceStamps,
  now: string,
  writerThreadId: ThreadId | null,
): Workspace | ThreadWorkspaceError {
  const next = {
    ...current,
    groups: [...current.groups],
    questions: [...current.questions],
    actionItems: [...current.actionItems],
    designDocuments: [...current.designDocuments],
    agentWork: [...current.agentWork],
    verifications: [...current.verifications],
    decisions: [...current.decisions],
    contextItems: [...current.contextItems],
    relatedThreads: [...current.relatedThreads],
    markAnnotations: [...current.markAnnotations],
    summaryNotes: input.summaryNotes ?? current.summaryNotes,
    childPreamble: input.childPreamble ?? current.childPreamble,
  };
  // A tombstone stamp means the entity existed and was removed; removing it again is a no-op.
  const missing = (label: string, removedAt: number | undefined, id: string) =>
    (removedAt ?? 0) > input.expectedRevision
      ? new ThreadWorkspaceError({
          code: "conflict",
          message: `${label} ${id} was removed by another edit after the revision you read.`,
          currentRevision: current.revision,
        })
      : invalid(`Unknown ${label.toLowerCase()} ${id}. Omit id to create one.`);
  const upsert = <T>(list: T[], index: number, value: T) => {
    if (index < 0) list.push(value);
    else list[index] = value;
  };
  for (const change of input.changes) {
    if (change.kind === "group") {
      const index = change.id ? next.groups.findIndex((group) => group.id === change.id) : -1;
      const old = next.groups[index];
      if (change.id && !old) {
        const removedAt = stamps[`group:${change.id}`];
        if (change.remove && removedAt !== undefined) continue;
        return missing("Group", removedAt, change.id);
      }
      if (change.remove) {
        next.groups.splice(index, 1);
        continue;
      }
      upsert(next.groups, index, {
        id: old?.id ?? NodeCrypto.randomUUID(),
        parentId: change.parentId === undefined ? (old?.parentId ?? null) : change.parentId,
        title: change.title ?? old?.title ?? "New group",
      });
    } else if (change.kind === "relatedThread" || change.kind === "mark") {
      if (change.kind === "relatedThread") {
        if (!change.threadId) return invalid("A related thread needs threadId.");
        const index = next.relatedThreads.findIndex(
          (thread) => thread.threadId === change.threadId,
        );
        if (change.remove) {
          if (index >= 0) next.relatedThreads.splice(index, 1);
        } else
          upsert(next.relatedThreads, index, {
            threadId: change.threadId,
            why: change.why ?? next.relatedThreads[index]?.why ?? "",
          });
      } else {
        const url =
          change.url ??
          (change.contextSource === undefined
            ? undefined
            : `t3-context-mark:${NodeCrypto.randomUUID()}`);
        if (!url)
          return invalid("A mark annotation needs url, or contextSource for a context mark.");
        const index = next.markAnnotations.findIndex((mark) => mark.url === url);
        const old = next.markAnnotations[index];
        if (change.remove) {
          if (index >= 0) next.markAnnotations.splice(index, 1);
        } else {
          const requested = change.contextSource;
          const point =
            requested?.threadId === undefined || requested.runId === undefined
              ? undefined
              : {
                  threadId: requested.threadId,
                  runId: requested.runId,
                  ...(requested.checkpointId === undefined
                    ? {}
                    : { checkpointId: requested.checkpointId }),
                };
          if (requested !== undefined && point === undefined)
            return invalid("A context mark's point could not be resolved.");
          if (
            point !== undefined &&
            old !== undefined &&
            (old.contextSource?.threadId !== point.threadId ||
              old.contextSource.runId !== point.runId)
          )
            return invalid("A mark's context point is fixed when it is made. Make a new mark.");
          const contextSource = old?.contextSource ?? point;
          const name = change.name ?? old?.name;
          upsert(next.markAnnotations, index, {
            url,
            description: change.description ?? old?.description ?? "",
            ...(name === undefined ? {} : { name }),
            ...(contextSource === undefined ? {} : { contextSource }),
          });
        }
      }
    } else {
      const [collection, prefix] = itemKinds[change.kind];
      const list: Array<Workspace[ItemCollection][number]> = next[collection];
      const index = change.id
        ? list.findIndex((item) => item.id === change.id || item.ref === change.id)
        : -1;
      const old = list[index];
      if (change.id && !old) {
        const removedAt = stamps[`item:${change.id}`] ?? stamps[`ref:${change.id}`];
        if (change.remove && removedAt !== undefined) continue;
        return missing(change.kind[0]!.toUpperCase() + change.kind.slice(1), removedAt, change.id);
      }
      if (change.remove) {
        list.splice(index, 1);
        continue;
      }
      const id = old?.id ?? NodeCrypto.randomUUID();
      const workId =
        change.kind === "verification" && change.workId !== undefined
          ? next.agentWork.find((work) => work.id === change.workId || work.ref === change.workId)
              ?.id
          : undefined;
      if (change.kind === "verification" && change.workId !== undefined && workId === undefined)
        return invalid(`Unknown agent work ${change.workId} for this verification.`);
      const item = buildItem(
        change.kind,
        id,
        old?.ref ?? shortRef(prefix, id),
        old as Record<string, unknown> | undefined,
        workId === undefined ? change : { ...change, workId },
        actor,
        now,
        writerThreadId,
      );
      if (isWorkspaceError(item)) return item;
      upsert(list, index, item as Workspace[ItemCollection][number]);
    }
  }
  return next;
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const tracker = yield* TicketTracker.TicketTracker;
  const enrichWork = Effect.fn("ThreadWorkspace.enrichWork")(function* (
    items: Workspace["agentWork"],
    refresh = false,
  ) {
    const keys = [...new Set(items.flatMap((item) => (item.ticket ? [item.ticket] : [])))];
    const tickets = new Map(
      yield* Effect.forEach(
        keys,
        (key) => tracker.get(key, { refresh }).pipe(Effect.map((data) => [key, data] as const)),
        { concurrency: 2 },
      ),
    );
    return items.map((item) =>
      item.ticket ? { ...item, ticketData: tickets.get(item.ticket) ?? null } : item,
    );
  });
  const enrich = Effect.fn("ThreadWorkspace.enrich")(function* (
    workspace: Workspace,
    refresh = false,
  ) {
    return { ...workspace, agentWork: yield* enrichWork(workspace.agentWork, refresh) };
  });
  const lock = yield* Semaphore.make(1);
  const directory = path.join(config.stateDir, "thread-workspaces");
  const filePath = (threadId: Workspace["threadId"]) =>
    path.join(directory, `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`);
  const requireThread = Effect.fn("ThreadWorkspace.requireThread")(function* (
    threadId: Workspace["threadId"],
  ) {
    const records = yield* orchestrator.getThreadRecords(threadId, []).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: isProjectionError(cause) && isMissingThread(cause.cause) ? "not_found" : "thread",
            operation: "loadThread",
            message: "Could not load the workspace's thread.",
            cause,
          }),
      ),
    );
    if (records.thread.deletedAt !== null)
      return yield* new ThreadWorkspaceError({
        code: "not_found",
        operation: "loadThread",
        message: "The workspace's thread was deleted.",
      });
    return records.thread;
  });
  const read = Effect.fn("ThreadWorkspace.read")(function* (threadId: Workspace["threadId"]) {
    const contents = yield* fs.readFileString(filePath(threadId)).pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: "storage",
            operation: "read",
            message: "Could not read the thread workspace.",
            cause,
          }),
      ),
    );
    let workspace = emptyWorkspace(threadId);
    let stamps: WorkspaceStamps = {};
    let legacy = contents === null;
    if (contents !== null) {
      const decoded = yield* decodeWorkspace(contents).pipe(Effect.result);
      if (decoded._tag === "Success") {
        workspace = decoded.success.workspace;
        stamps = decoded.success.stamps ?? {};
      } else {
        const old = yield* decodeLegacy(contents).pipe(
          Effect.mapError(
            (cause) =>
              new ThreadWorkspaceError({
                code: "storage",
                operation: "decode",
                message: "The saved thread workspace is malformed.",
                cause,
              }),
          ),
        );
        workspace = {
          ...workspace,
          ...old.workspace,
          actionItems: old.workspace.actionItems.map((item) => ({
            ...item,
            ref: item.ref ?? shortRef("A", item.id),
            groupId: item.groupId ?? WORKSPACE_DEFAULT_GROUP_ID,
          })),
        };
        if (workspace.designNotes)
          workspace = {
            ...workspace,
            designNotes: "",
            designDocuments: [
              {
                id: "legacy-design",
                ref: shortRef("D", "legacy-design"),
                groupId: WORKSPACE_DEFAULT_GROUP_ID,
                title: "Design",
                markdown: workspace.designNotes,
                html: null,
              },
            ],
          };
        legacy = true;
      }
    }
    if (legacy) {
      const files = yield* fs.readDirectory(path.join(config.stateDir, "review-artifacts")).pipe(
        Effect.catchIf(
          (cause) => cause.reason._tag === "NotFound",
          () => Effect.succeed([]),
        ),
        Effect.mapError(
          (cause) =>
            new ThreadWorkspaceError({
              code: "storage",
              operation: "migrateReviews",
              message: "Could not read existing reviews.",
              cause,
            }),
        ),
      );
      for (const name of files.filter((name) => /^[a-f0-9-]+\.json$/i.test(name))) {
        const contents = yield* fs
          .readFileString(path.join(config.stateDir, "review-artifacts", name))
          .pipe(
            Effect.mapError(
              (cause) =>
                new ThreadWorkspaceError({
                  code: "storage",
                  operation: "migrateReviews",
                  message: "Could not read an existing review.",
                  cause,
                }),
            ),
          );
        const owner = legacyReviewOwner(contents);
        if (Option.isNone(owner)) {
          yield* Effect.logWarning(
            "Could not identify an earlier review's thread; original file retained",
            { name },
          );
          continue;
        }
        if (owner.value !== threadId) continue;
        const review = yield* decodeReview(contents).pipe(
          Effect.mapError(
            (cause) =>
              new ThreadWorkspaceError({
                code: "storage",
                operation: "migrateReviews",
                message: "An existing review is malformed.",
                cause,
              }),
          ),
        );
        if (review.artifact.threadId === threadId)
          workspace = addReview(workspace, review.artifact);
      }
    }
    const invalid = validationError(workspace);
    if (workspace.threadId !== threadId || invalid !== null)
      return yield* new ThreadWorkspaceError({
        code: "storage",
        operation: "validate",
        message: invalid ?? "The workspace belongs to another thread.",
      });
    return { workspace: legacy ? yield* write(workspace, stamps) : workspace, stamps };
  });
  const write = Effect.fn("ThreadWorkspace.write")(function* (
    workspace: Workspace,
    stamps: WorkspaceStamps,
  ) {
    const invalid = validationError(workspace);
    if (invalid !== null)
      return yield* new ThreadWorkspaceError({
        code: "invalid",
        operation: "validate",
        message: invalid,
      });
    const contents = yield* encodeWorkspace({ formatVersion: 2, workspace, stamps }).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: "storage",
            operation: "encode",
            message: "Could not encode the thread workspace.",
            cause,
          }),
      ),
    );
    yield* writeFileStringAtomically({ filePath: filePath(workspace.threadId), contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: "storage",
            operation: "write",
            message: "Could not save the thread workspace.",
            cause,
          }),
      ),
    );
    return workspace;
  });
  // Writers merge at field level: only fields that both this write and a later write changed conflict.
  const commit = Effect.fn("ThreadWorkspace.commit")(function* (
    current: Workspace,
    stamps: WorkspaceStamps,
    next: Workspace,
    expectedRevision: number,
  ) {
    if (expectedRevision > current.revision)
      return yield* new ThreadWorkspaceError({
        code: "conflict",
        operation: "save",
        message: "The workspace revision you read is newer than the saved one. Reload it.",
        currentRevision: current.revision,
      });
    const keys = changedKeys(current, next);
    if (!keys.length) return current;
    const conflicts = conflictingKeys(stamps, keys, expectedRevision);
    if (conflicts.length)
      return yield* new ThreadWorkspaceError({
        code: "conflict",
        operation: "save",
        message: describeConflict(current, conflicts),
        currentRevision: current.revision,
      });
    const revision = current.revision + 1;
    return yield* write(
      { ...next, revision, updatedAt: DateTime.formatIso(yield* DateTime.now) },
      restamp(stamps, keys, next, revision),
    );
  });
  // Marks store a fixed run, so a mark made from "latest" never follows later turns.
  const resolveContextMarkPoints = Effect.fn("ThreadWorkspace.resolveContextMarkPoints")(function* (
    owner: { readonly id: ThreadId; readonly projectId: ProjectId },
    changes: ThreadWorkspaceMutateInput["changes"],
  ) {
    return yield* Effect.forEach(changes, (change) =>
      Effect.gen(function* () {
        const requested = change.contextSource;
        if (change.kind !== "mark" || change.remove || requested === undefined) return change;
        if (requested.runId !== undefined && requested.checkpointId !== undefined)
          return yield* new ThreadWorkspaceError({
            code: "invalid",
            message: "Pass either a runId or checkpointId for a context mark.",
          });
        const threadId = requested.threadId ?? owner.id;
        const unavailable = new ThreadWorkspaceError({
          code: "invalid",
          message: `Context thread ${threadId} is not an available thread in this project.`,
        });
        const source = yield* orchestrator
          .getThreadRecords(threadId, ["runs", "checkpoints"])
          .pipe(Effect.mapError(() => unavailable));
        if (source.thread.deletedAt !== null || source.thread.projectId !== owner.projectId)
          return yield* unavailable;
        const run = Orchestrator.runForSourcePoint(
          source,
          requested.runId !== undefined
            ? { type: "run", runId: requested.runId }
            : requested.checkpointId !== undefined
              ? { type: "checkpoint", checkpointId: requested.checkpointId }
              : { type: "latest_stable" },
        );
        if (run === null || !isForkableSourceRunStatus(run.status))
          return yield* new ThreadWorkspaceError({
            code: "invalid",
            message: `Thread ${threadId} has no finished turn at that point to mark.`,
          });
        return {
          ...change,
          contextSource: {
            threadId,
            runId: run.id,
            ...(run.checkpointId === null ? {} : { checkpointId: run.checkpointId }),
          },
        };
      }),
    );
  });
  const change = Effect.fn("ThreadWorkspace.change")(function* (
    input: ThreadWorkspaceMutateInput,
    actor: WorkspaceActor,
    writerThreadId: ThreadId | null,
  ) {
    const owner = yield* requireThread(input.threadId);
    const changes = yield* resolveContextMarkPoints(owner, input.changes);
    const { workspace: current, stamps } = yield* read(input.threadId);
    const now = DateTime.formatIso(yield* DateTime.now);
    const next = applyChanges(current, { ...input, changes }, actor, stamps, now, writerThreadId);
    if (isWorkspaceError(next)) return yield* next;
    return { before: current, after: yield* commit(current, stamps, next, input.expectedRevision) };
  }, lock.withPermit);
  const sentFeedback = Effect.fn("ThreadWorkspace.sentFeedback")(function* (
    threadId: Workspace["threadId"],
  ) {
    const records = yield* orchestrator
      .getThreadRecords(threadId, ["messages"], { messageRoles: ["user"] })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadWorkspaceError({
              code: "thread",
              operation: "loadMessages",
              message: "Could not load the thread's sent feedback.",
              cause,
            }),
        ),
      );
    return submittedFeedback(threadId, records.messages);
  });
  const patch = Effect.fn("ThreadWorkspace.patch")(function* (input: ThreadWorkspaceMutateInput) {
    return yield* enrich((yield* change(input, "user", null)).after);
  });
  // Returns only what this write changed unless the caller asks for the full index.
  const mutate = Effect.fn("ThreadWorkspace.mutate")(function* (
    input: ThreadWorkspaceMutateInput,
    writerThreadId: ThreadId | null = null,
  ) {
    const { before, after } = yield* change(input, "agent", writerThreadId);
    const submitted = yield* sentFeedback(input.threadId);
    if (input.fullIndex) return queryWorkspace(after, { section: "index" }, submitted);
    const keys = changedKeys(before, after);
    const itemIds = changedItemIds(keys);
    const groupIds = new Set(
      after.groups
        .filter((group) => keys.some((key) => key.startsWith(`group:${group.id}`)))
        .map((group) => group.id),
    );
    const present = new Set([
      ...indexEntries(after, submitted).map((item) => item.id),
      ...after.groups.map((group) => group.id),
    ]);
    const removedIds = [
      ...itemIds,
      ...before.groups.filter((group) => !present.has(group.id)).map((group) => group.id),
    ].filter((id) => !present.has(id));
    return {
      threadId: after.threadId,
      revision: after.revision,
      groups: after.groups.filter((group) => groupIds.has(group.id)),
      items: indexEntries(after, submitted).filter((item) => itemIds.has(item.id)),
      ...(after.agentWork.some((item) => itemIds.has(item.id))
        ? {
            agentWork: yield* enrichWork(after.agentWork.filter((item) => itemIds.has(item.id))),
          }
        : {}),
      ...(removedIds.length ? { removedIds } : {}),
      ...(input.summaryNotes !== undefined ? { summaryNotes: after.summaryNotes } : {}),
    };
  });
  const get = Effect.fn("ThreadWorkspace.get")(function* (
    input: ThreadWorkspaceGetInput,
    options?: { readonly refreshTickets?: boolean },
  ) {
    const workspace = yield* Effect.gen(function* () {
      yield* requireThread(input.threadId);
      return (yield* read(input.threadId)).workspace;
    }).pipe(lock.withPermit);
    return yield* enrich(workspace, options?.refreshTickets);
  });
  const saveDraft = Effect.fn("ThreadWorkspace.saveDraft")(function* (
    input: ThreadWorkspaceSaveDraftInput,
  ) {
    yield* requireThread(input.threadId);
    const { workspace: current, stamps } = yield* read(input.threadId);
    const invalid = workspaceDraftError(current, input.userDraft);
    if (invalid !== null)
      return yield* new ThreadWorkspaceError({ code: "invalid", message: invalid });
    return yield* commit(
      current,
      stamps,
      {
        ...current,
        userDraft: {
          questionAnswers: {
            ...current.userDraft.questionAnswers,
            ...input.userDraft.questionAnswers,
          },
          actionNotes: { ...current.userDraft.actionNotes, ...input.userDraft.actionNotes },
        },
      },
      input.expectedRevision,
    );
  }, lock.withPermit);
  const submit = Effect.fn("ThreadWorkspace.submit")(function* (input: ThreadWorkspaceSubmitInput) {
    const owner = yield* requireThread(input.threadId);
    const { workspace: current, stamps } = yield* read(input.threadId);
    const readyIds = new Set(readyWorkspaceFeedbackIds(current));
    const readyQuestions = current.questions.filter((question) => readyIds.has(question.id));
    const readyActions = current.actionItems.filter(
      (item) => input.itemIds.includes(item.id) || readyIds.has(item.id),
    );
    const requested = new Set(
      input.itemIds.length
        ? input.itemIds
        : [...readyQuestions, ...readyActions].map((item) => item.id),
    );
    const items = [...readyQuestions, ...readyActions].filter((item) => requested.has(item.id));
    const stale = items.flatMap((item) =>
      [`item:${item.id}`, `draft.answer:${item.id}`, `draft.note:${item.id}`].filter((key) =>
        entityChangedSince(stamps, key, input.expectedRevision),
      ),
    );
    if (stale.length || input.expectedRevision > current.revision)
      return yield* new ThreadWorkspaceError({
        code: "conflict",
        operation: "submit",
        message: describeConflict(current, stale),
        currentRevision: current.revision,
      });
    const invalid = workspaceDraftError(current, {
      questionAnswers: Object.fromEntries(
        Object.entries(current.userDraft.questionAnswers).filter(([id]) => requested.has(id)),
      ),
      actionNotes: {},
    });
    if (invalid !== null)
      return yield* new ThreadWorkspaceError({
        code: "invalid",
        operation: "submit",
        message: invalid,
      });
    if (!items.length || items.length !== requested.size)
      return yield* new ThreadWorkspaceError({
        code: "invalid",
        message: "Choose an answer or add a note before adding it to chat.",
      });
    const snapshot = items.map((item) => {
      const answer = current.userDraft.questionAnswers[item.id];
      return { item, answer, note: current.userDraft.actionNotes[item.id] };
    });
    const serialized = yield* encodeSnapshot(snapshot).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadWorkspaceError({
            code: "invalid",
            operation: "submit",
            message: "Could not encode workspace feedback.",
            cause,
          }),
      ),
    );
    const key = NodeCrypto.createHash("sha256").update(serialized).digest("hex");
    if (current.submissions.some((submission) => submission.key === key)) return current;
    const environmentId = yield* environment.getEnvironmentId;
    const { records, markdown } = formatWorkspaceFeedback(
      { environmentId, threadId: input.threadId },
      current,
      items.map((item) => item.id),
    );
    const messageId = MessageId.make(`workspace:${input.threadId}:${key}`);
    yield* threads
      .sendToThread({
        projectId: owner.projectId,
        commandId: CommandId.make(`workspace-submit:${input.threadId}:${key}`),
        threadId: input.threadId,
        messageId,
        text: markdown,
        context: { version: 1, records },
        attachments: [],
        mode: "queue",
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadWorkspaceError({
              code: "send",
              operation: "submit",
              message:
                "Could not add workspace feedback to chat. Your draft is saved; retry sending.",
              cause,
            }),
        ),
      );
    return yield* write(
      {
        ...current,
        submissions: [
          ...current.submissions,
          {
            key,
            itemIds: items.map((item) => item.id),
            messageId,
            markdown,
            submittedAt: DateTime.formatIso(yield* DateTime.now),
          },
        ],
      },
      stamps,
    );
  }, lock.withPermit);
  return ThreadWorkspace.of({
    get,
    listWork: Effect.fn("ThreadWorkspace.listWork")(function* (input) {
      const files = yield* fs.readDirectory(directory).pipe(
        Effect.catchIf(
          (cause) => cause.reason._tag === "NotFound",
          () => Effect.succeed([]),
        ),
        Effect.mapError(
          (cause) =>
            new ThreadWorkspaceError({
              code: "storage",
              operation: "listWork",
              message: "Could not list saved agent work.",
              cause,
            }),
        ),
      );
      const entries: ThreadWorkspaceWorkEntry[] = [];
      for (const name of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).toSorted()) {
        const contents = yield* fs.readFileString(path.join(directory, name)).pipe(
          Effect.catchIf(
            (cause) => cause.reason._tag === "NotFound",
            () => Effect.succeed(null),
          ),
          Effect.mapError(
            (cause) =>
              new ThreadWorkspaceError({
                code: "storage",
                operation: "listWork",
                message: "Could not read saved agent work.",
                cause,
              }),
          ),
        );
        if (contents === null) continue;
        const decoded = yield* decodeWorkspace(contents).pipe(Effect.result);
        if (decoded._tag === "Failure") {
          const legacy = yield* decodeLegacy(contents).pipe(Effect.result);
          if (legacy._tag === "Success") continue;
          return yield* new ThreadWorkspaceError({
            code: "storage",
            operation: "listWork",
            message: "A saved thread workspace is malformed.",
            cause: decoded.failure,
          });
        }
        const workspace = decoded.success.workspace;
        if (filePath(workspace.threadId) !== path.join(directory, name))
          return yield* new ThreadWorkspaceError({
            code: "storage",
            operation: "listWork",
            message: "A saved workspace belongs to another thread.",
          });
        const thread = yield* requireThread(workspace.threadId).pipe(
          Effect.catchIf(
            (cause) => cause.code === "not_found",
            () => Effect.succeed(null),
          ),
        );
        if (thread === null) continue;
        const items = workspace.agentWork.filter(
          (item) => input.userQa === undefined || input.userQa.includes(item.userQa),
        );
        for (const item of yield* enrichWork(items)) {
          entries.push({
            threadId: workspace.threadId,
            threadTitle: thread.title,
            revision: workspace.revision,
            item,
            verifications: workspace.verifications.filter((entry) => entry.workId === item.id),
          });
        }
      }
      return entries.toSorted((a, b) =>
        (b.item.completedAt ?? "").localeCompare(a.item.completedAt ?? ""),
      );
    }),
    counts: Effect.fn("ThreadWorkspace.counts")(function* (input) {
      yield* requireThread(input.threadId);
      const workspace = (yield* read(input.threadId)).workspace;
      return {
        questions: workspace.questions.length,
        unansweredQuestions: workspace.questions.filter((question) => {
          const answer = workspace.userDraft.questionAnswers[question.id];
          return !answer || (!answer.selectedOptionIds.length && !answer.notes.trim());
        }).length,
        actions: workspace.actionItems.length,
        outstandingActions: workspace.actionItems.filter((item) => item.status !== "done").length,
        designs: workspace.designDocuments.length,
        relatedThreads: workspace.relatedThreads.length,
        agentWork: workspace.agentWork.length,
        openAgentWork: workspace.agentWork.filter(
          (item) => item.status !== "done" && item.status !== "landed",
        ).length,
        pendingQa: workspace.agentWork.filter((item) => item.userQa === "pending").length,
        records: workspace.decisions.length + workspace.contextItems.length,
      };
    }, lock.withPermit),
    patch,
    saveDraft,
    submit,
    mutate,
    query: Effect.fn("ThreadWorkspace.query")(function* (input) {
      const workspace = yield* get(input);
      const needsFeedback = ["index", "questions", "actions", "record", "all"].includes(
        input.section ?? "index",
      );
      return queryWorkspace(
        workspace,
        input,
        needsFeedback ? yield* sentFeedback(input.threadId) : new Map(),
      );
    }),
    importReview: Effect.fn("ThreadWorkspace.importReview")(function* (review) {
      yield* requireThread(review.threadId);
      const { workspace: current, stamps } = yield* read(review.threadId);
      yield* commit(current, stamps, addReview(current, review), current.revision);
    }, lock.withPermit),
  });
});
export const layer = Layer.effect(ThreadWorkspace, make);

export const layerTicketRefresh = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const workspace = yield* ThreadWorkspace;
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" &&
        ["completed", "failed", "cancelled", "interrupted"].includes(event.payload.status)
          ? workspace
              .get({ threadId: event.threadId }, { refreshTickets: true })
              .pipe(Effect.ignore)
          : Effect.void,
      ),
    );
  }),
);

/** Every thread reads as an empty workspace; for services that only read it. */
export const layerTest = Layer.mock(ThreadWorkspace)({
  get: ({ threadId }) => Effect.succeed(emptyWorkspace(threadId)),
});
