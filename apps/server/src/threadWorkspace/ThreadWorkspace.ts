// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  MessageId,
  ReviewArtifact,
  ThreadWorkspace as Workspace,
  ThreadWorkspaceError,
  WORKSPACE_DEFAULT_GROUP_ID,
  type ThreadWorkspaceGetInput,
  type ThreadWorkspacePatchInput,
  type ThreadWorkspaceSaveDraftInput,
  type ThreadWorkspaceSubmitInput,
  type ThreadWorkspaceMutateInput,
  type WorkspaceQuery,
  type WorkspaceQueryResult,
  type WorkspaceUserDraft,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import {
  formatComposerContextHref,
  sanitizeComposerContextLabel,
  toComposerContextId,
} from "@t3tools/shared/composerContextReferences";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectionStoreThreadNotFoundError } from "../orchestration-v2/ProjectionStore.ts";

export class ThreadWorkspace extends Context.Service<
  ThreadWorkspace,
  {
    readonly get: (
      input: ThreadWorkspaceGetInput,
    ) => Effect.Effect<Workspace, ThreadWorkspaceError>;
    readonly patch: (
      input: ThreadWorkspacePatchInput,
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
    readonly mutate: (
      input: ThreadWorkspaceMutateInput,
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
    designNotes: "",
    summaryNotes: "",
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
  const items = [...workspace.questions, ...workspace.actionItems, ...workspace.designDocuments];
  if (new Set(items.map((item) => item.id)).size !== items.length)
    return "Workspace item IDs must be unique.";
  const refs = items.map((item) => item.ref).filter((ref) => ref !== undefined);
  if (new Set(refs).size !== refs.length) return "Workspace references must be unique.";
  if (items.some((item) => !groups.has(item.groupId ?? WORKSPACE_DEFAULT_GROUP_ID)))
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
  return null;
}
function draftError(workspace: Workspace, draft: WorkspaceUserDraft): string | null {
  for (const [id, answer] of Object.entries(draft.questionAnswers)) {
    const question = workspace.questions.find((question) => question.id === id);
    if (!question) continue;
    if (
      new Set(answer.selectedOptionIds).size !== answer.selectedOptionIds.length ||
      answer.selectedOptionIds.some(
        (optionId) => !question.options.some((option) => option.id === optionId),
      ) ||
      (!question.multiSelect && answer.selectedOptionIds.length > 1)
    )
      return "Answer selections must match the question's options and selection mode.";
  }
  return null;
}
function queryWorkspace(workspace: Workspace, query: WorkspaceQuery): WorkspaceQueryResult {
  const section = query.section ?? "index";
  const wanted = (item: { id: string; ref?: string | undefined; groupId?: string | undefined }) =>
    (query.groupId === undefined || item.groupId === query.groupId) &&
    (query.itemIds === undefined ||
      query.itemIds.includes(item.id) ||
      (item.ref !== undefined && query.itemIds.includes(item.ref)));
  const requestedIds = new Set(
    [...workspace.questions, ...workspace.actionItems].filter(wanted).map((item) => item.id),
  );
  const latestSubmissionKeys = new Set(
    [...requestedIds].flatMap((id) => {
      const submission = workspace.submissions.findLast((submission) =>
        submission.itemIds.includes(id),
      );
      return submission ? [submission.key] : [];
    }),
  );
  const submissions = workspace.submissions.filter((submission) =>
    latestSubmissionKeys.has(submission.key),
  );
  return {
    threadId: workspace.threadId,
    revision: workspace.revision,
    groups: workspace.groups,
    items: [
      ...workspace.questions.map((item) => ({
        id: item.id,
        ref: item.ref,
        groupId: item.groupId,
        kind: "question",
        title: item.title,
      })),
      ...workspace.actionItems.map((item) => ({
        id: item.id,
        ref: item.ref ?? "",
        groupId: item.groupId ?? WORKSPACE_DEFAULT_GROUP_ID,
        kind: "action",
        title: item.title,
      })),
      ...workspace.designDocuments.map((item) => ({
        id: item.id,
        ref: item.ref,
        groupId: item.groupId,
        kind: "design",
        title: item.title,
      })),
    ].filter(wanted),
    ...(section === "questions" || section === "all"
      ? { questions: workspace.questions.filter(wanted), submissions }
      : {}),
    ...(section === "actions" || section === "all"
      ? { actionItems: workspace.actionItems.filter(wanted), submissions }
      : {}),
    ...(section === "design" || section === "all"
      ? { designDocuments: workspace.designDocuments.filter(wanted) }
      : {}),
    ...(section === "summary" || section === "all" ? { summaryNotes: workspace.summaryNotes } : {}),
    ...(section === "threads" || section === "all"
      ? { relatedThreads: workspace.relatedThreads }
      : {}),
    ...(section === "marks" || section === "all"
      ? { markAnnotations: workspace.markAnnotations }
      : {}),
  };
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

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
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
    let legacy = contents === null;
    if (contents !== null) {
      const decoded = yield* decodeWorkspace(contents).pipe(Effect.result);
      if (decoded._tag === "Success") workspace = decoded.success.workspace;
      else {
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
    return legacy ? yield* write(workspace) : workspace;
  });
  const write = Effect.fn("ThreadWorkspace.write")(function* (workspace: Workspace) {
    const invalid = validationError(workspace);
    if (invalid !== null)
      return yield* new ThreadWorkspaceError({
        code: "invalid",
        operation: "validate",
        message: invalid,
      });
    const contents = yield* encodeWorkspace({ formatVersion: 2, workspace }).pipe(
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
  const checkRevision = Effect.fn("ThreadWorkspace.checkRevision")(function* (
    workspace: Workspace,
    expected: number,
  ) {
    if (workspace.revision !== expected)
      return yield* new ThreadWorkspaceError({
        code: "conflict",
        operation: "save",
        message: "The workspace changed. Reload it before saving again.",
        currentRevision: workspace.revision,
      });
  });
  const patch = Effect.fn("ThreadWorkspace.patch")(function* (input: ThreadWorkspacePatchInput) {
    yield* requireThread(input.threadId);
    const current = yield* read(input.threadId);
    yield* checkRevision(current, input.expectedRevision);
    const next = {
      ...current,
      groups: input.groups ?? current.groups,
      questions: input.questions ?? current.questions,
      designDocuments: input.designDocuments ?? current.designDocuments,
      designNotes: input.designNotes ?? current.designNotes,
      summaryNotes: input.summaryNotes ?? current.summaryNotes,
      relatedThreads: input.relatedThreads ?? current.relatedThreads,
      markAnnotations: input.markAnnotations ?? current.markAnnotations,
      actionItems: (input.actionItems ?? current.actionItems).map((item) => ({
        ...item,
        ref:
          current.actionItems.find((previous) => previous.id === item.id)?.ref ??
          item.ref ??
          shortRef("A", item.id),
        groupId: item.groupId ?? WORKSPACE_DEFAULT_GROUP_ID,
      })),
      revision: current.revision + 1,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    return yield* write(next);
  }, lock.withPermit);
  const get = Effect.fn("ThreadWorkspace.get")(function* (input: ThreadWorkspaceGetInput) {
    yield* requireThread(input.threadId);
    return yield* read(input.threadId);
  }, lock.withPermit);
  const saveDraft = Effect.fn("ThreadWorkspace.saveDraft")(function* (
    input: ThreadWorkspaceSaveDraftInput,
  ) {
    yield* requireThread(input.threadId);
    const current = yield* read(input.threadId);
    yield* checkRevision(current, input.expectedRevision);
    const invalid = draftError(current, input.userDraft);
    if (invalid !== null)
      return yield* new ThreadWorkspaceError({ code: "invalid", message: invalid });
    return yield* write({
      ...current,
      userDraft: input.userDraft,
      revision: current.revision + 1,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    });
  }, lock.withPermit);
  const mutate = Effect.fn("ThreadWorkspace.mutate")(function* (input: ThreadWorkspaceMutateInput) {
    yield* requireThread(input.threadId);
    const current = yield* read(input.threadId);
    yield* checkRevision(current, input.expectedRevision);
    let next = {
      ...current,
      groups: [...current.groups],
      questions: [...current.questions],
      actionItems: [...current.actionItems],
      designDocuments: [...current.designDocuments],
      relatedThreads: [...current.relatedThreads],
      markAnnotations: [...current.markAnnotations],
      summaryNotes: input.summaryNotes ?? current.summaryNotes,
    };
    for (const change of input.changes) {
      const id = change.id ?? NodeCrypto.randomUUID();
      if (change.kind === "group") {
        const old = next.groups.find((group) => group.id === id);
        if (change.id && !old)
          return yield* new ThreadWorkspaceError({
            code: "invalid",
            message: `Unknown group ${id}. Omit id to create a group.`,
          });
        next.groups = next.groups.filter((group) => group.id !== id);
        if (!change.remove)
          next.groups.push({
            id,
            parentId: change.parentId === undefined ? (old?.parentId ?? null) : change.parentId,
            title: change.title ?? old?.title ?? "New group",
          });
      } else if (change.kind === "question") {
        const old = next.questions.find((question) => question.id === id || question.ref === id);
        if (change.id && !old)
          return yield* new ThreadWorkspaceError({
            code: "invalid",
            message: `Unknown question ${id}. Omit id to create one.`,
          });
        const itemId = old?.id ?? id;
        next.questions = next.questions.filter((question) => question.id !== itemId);
        if (!change.remove)
          next.questions.push({
            id: itemId,
            ref: old?.ref ?? shortRef("Q", itemId),
            groupId: change.groupId ?? old?.groupId ?? WORKSPACE_DEFAULT_GROUP_ID,
            title: change.title ?? old?.title ?? "Question",
            details: change.details ?? old?.details ?? "",
            options: change.options ?? old?.options ?? [],
            recommendedOptionIds: change.recommendedOptionIds ?? old?.recommendedOptionIds ?? [],
            recommendation: change.recommendation ?? old?.recommendation ?? "",
            multiSelect: change.multiSelect ?? old?.multiSelect ?? false,
          });
      } else if (change.kind === "action") {
        const old = next.actionItems.find((item) => item.id === id || item.ref === id);
        if (change.id && !old)
          return yield* new ThreadWorkspaceError({
            code: "invalid",
            message: `Unknown action ${id}. Omit id to create one.`,
          });
        const itemId = old?.id ?? id;
        next.actionItems = next.actionItems.filter((item) => item.id !== itemId);
        if (!change.remove)
          next.actionItems.push({
            id: itemId,
            ref: old?.ref ?? shortRef("A", itemId),
            groupId: change.groupId ?? old?.groupId ?? WORKSPACE_DEFAULT_GROUP_ID,
            title: change.title ?? old?.title ?? "Action item",
            details: change.details ?? old?.details ?? "",
            status: change.status ?? old?.status ?? "open",
          });
      } else if (change.kind === "design") {
        const old = next.designDocuments.find(
          (document) => document.id === id || document.ref === id,
        );
        if (change.id && !old)
          return yield* new ThreadWorkspaceError({
            code: "invalid",
            message: `Unknown design ${id}. Omit id to create one.`,
          });
        const itemId = old?.id ?? id;
        next.designDocuments = next.designDocuments.filter((document) => document.id !== itemId);
        if (!change.remove)
          next.designDocuments.push({
            id: itemId,
            ref: old?.ref ?? shortRef("D", itemId),
            groupId: change.groupId ?? old?.groupId ?? WORKSPACE_DEFAULT_GROUP_ID,
            title: change.title ?? old?.title ?? "Design",
            markdown: change.markdown ?? old?.markdown ?? "",
            html: change.html === undefined ? (old?.html ?? null) : change.html,
          });
      } else if (change.kind === "relatedThread") {
        if (!change.threadId)
          return yield* new ThreadWorkspaceError({
            code: "invalid",
            message: "A related thread needs threadId.",
          });
        const related = next.relatedThreads.find((thread) => thread.threadId === change.threadId);
        next.relatedThreads = next.relatedThreads.filter(
          (thread) => thread.threadId !== change.threadId,
        );
        if (!change.remove)
          next.relatedThreads.push({
            threadId: change.threadId,
            why: change.why ?? related?.why ?? "",
          });
      } else {
        if (!change.url)
          return yield* new ThreadWorkspaceError({
            code: "invalid",
            message: "A mark annotation needs url.",
          });
        const mark = next.markAnnotations.find((mark) => mark.url === change.url);
        next.markAnnotations = next.markAnnotations.filter((mark) => mark.url !== change.url);
        if (!change.remove)
          next.markAnnotations.push({
            url: change.url,
            description: change.description ?? mark?.description ?? "",
          });
      }
    }
    next = {
      ...next,
      revision: current.revision + 1,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    return queryWorkspace(yield* write(next), { section: "index" });
  }, lock.withPermit);
  const submit = Effect.fn("ThreadWorkspace.submit")(function* (input: ThreadWorkspaceSubmitInput) {
    const owner = yield* requireThread(input.threadId);
    const current = yield* read(input.threadId);
    yield* checkRevision(current, input.expectedRevision);
    const readyQuestions = current.questions.filter((question) => {
      const answer = current.userDraft.questionAnswers[question.id];
      return answer !== undefined && (answer.notes.trim() || answer.selectedOptionIds.length);
    });
    const readyActions = current.actionItems.filter(
      (item) => input.itemIds.includes(item.id) || current.userDraft.actionNotes[item.id]?.trim(),
    );
    const requested = new Set(
      input.itemIds.length
        ? input.itemIds
        : [...readyQuestions, ...readyActions].map((item) => item.id),
    );
    const items = [...readyQuestions, ...readyActions].filter((item) => requested.has(item.id));
    const invalid = draftError(current, {
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
    const records = items.map((item) => ({
      version: 1 as const,
      kind: "thread" as const,
      contextId: toComposerContextId(`workspace-${item.id}`),
      label: sanitizeComposerContextLabel(`${item.ref ?? item.id} ${item.title}`, "thread"),
      environmentId,
      threadId: input.threadId,
      title: item.title.slice(0, 200),
      workspaceItemId: item.id,
      workspaceSection: current.questions.some((question) => question.id === item.id)
        ? ("questions" as const)
        : ("actions" as const),
    }));
    const markdown = snapshot
      .map(({ item, answer, note }, index) => {
        const record = records[index]!;
        const heading = `[${record.label}](${formatComposerContextHref("thread", record.contextId)})`;
        const question = current.questions.find((question) => question.id === item.id);
        if (question && answer)
          return [
            heading,
            `Question: ${question.title}`,
            ...(answer.selectedOptionIds.length
              ? [
                  `Answer: ${answer.selectedOptionIds.map((id) => question.options.find((option) => option.id === id)?.label ?? id).join("; ")}`,
                ]
              : []),
            ...(answer.notes.trim() ? [`Notes: ${answer.notes.trim()}`] : []),
          ].join("\n");
        const action = current.actionItems.find((action) => action.id === item.id)!;
        return [
          heading,
          `Action: ${action.title}`,
          `Status: ${action.status}`,
          ...(note?.trim() ? [`Notes: ${note.trim()}`] : []),
        ].join("\n");
      })
      .join("\n\n");
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
    return yield* write({
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
    });
  }, lock.withPermit);
  return ThreadWorkspace.of({
    get,
    patch,
    saveDraft,
    submit,
    mutate,
    query: Effect.fn("ThreadWorkspace.query")(function* (input) {
      return queryWorkspace(yield* get(input), input);
    }),
    importReview: Effect.fn("ThreadWorkspace.importReview")(function* (review) {
      yield* requireThread(review.threadId);
      const current = yield* read(review.threadId);
      yield* write({
        ...addReview(current, review),
        revision: current.revision + 1,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      });
    }, lock.withPermit),
  });
});
export const layer = Layer.effect(ThreadWorkspace, make);
