import {
  CommandId,
  MessageId,
  ReviewArtifact,
  ReviewArtifactError,
  ReviewId,
  type ReviewContent,
  type ReviewDraft,
  type ReviewSummary,
  type ReviewPublished,
  type ReviewCreateInput,
  type ReviewListInput,
  type ReviewGetInput,
  type ReviewSaveInput,
  type ReviewSubmitInput,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
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
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectionStoreThreadNotFoundError } from "../orchestration-v2/ProjectionStore.ts";

export class ReviewArtifacts extends Context.Service<
  ReviewArtifacts,
  {
    readonly create: (
      input: ReviewCreateInput,
    ) => Effect.Effect<ReviewArtifact, ReviewArtifactError>;
    readonly list: (
      input: ReviewListInput,
    ) => Effect.Effect<ReadonlyArray<ReviewSummary>, ReviewArtifactError>;
    readonly get: (input: ReviewGetInput) => Effect.Effect<ReviewArtifact, ReviewArtifactError>;
    readonly getPublished: (
      input: ReviewGetInput,
    ) => Effect.Effect<ReviewPublished, ReviewArtifactError>;
    readonly save: (input: ReviewSaveInput) => Effect.Effect<ReviewArtifact, ReviewArtifactError>;
    readonly submit: (
      input: ReviewSubmitInput,
    ) => Effect.Effect<ReviewArtifact, ReviewArtifactError>;
    readonly due: () => Effect.Effect<ReadonlyArray<ReviewSummary>, ReviewArtifactError>;
  }
>()("t3/reviewArtifacts/ReviewArtifacts") {}

const PersistedReview = Schema.Struct({
  formatVersion: Schema.Literal(1),
  artifact: ReviewArtifact,
});
const decodeReview = Schema.decodeEffect(Schema.fromJsonString(PersistedReview));
const encodeReview = Schema.encodeEffect(Schema.fromJsonString(PersistedReview));
const decodeId = Schema.decodeOption(ReviewId);
const isMissingThread = Schema.is(ProjectionStoreThreadNotFoundError);

function contentError(content: ReviewContent): string | null {
  const sections = new Set<string>();
  const questions = new Set<string>();
  for (const section of content.sections) {
    if (sections.has(section.id)) return "Section IDs must be unique.";
    sections.add(section.id);
    for (const question of section.questions) {
      if (questions.has(question.id)) return "Question IDs must be unique across the review.";
      questions.add(question.id);
      const options = new Set(question.options.map((option) => option.id));
      if (options.size !== question.options.length)
        return "Option IDs must be unique within a question.";
      if (question.recommendedOptionId !== null && !options.has(question.recommendedOptionId))
        return "The recommended option must belong to its question.";
    }
  }
  return null;
}

function draftError(content: ReviewContent, draft: ReviewDraft): string | null {
  const questions = new Map(
    content.sections.flatMap((section) =>
      section.questions.map((question) => [question.id, question] as const),
    ),
  );
  for (const [id, answer] of Object.entries(draft.answers)) {
    const question = questions.get(id);
    if (!question) return "An answer refers to an unknown question.";
    const selections = new Set(answer.selectedOptionIds);
    if (
      selections.size !== answer.selectedOptionIds.length ||
      (!question.multiSelect && selections.size > 1) ||
      [...selections].some(
        (selection) => !question.options.some((option) => option.id === selection),
      )
    )
      return "Selected options must belong to the question and respect its selection mode.";
  }
  const annotations = new Set<string>();
  for (const annotation of draft.annotations) {
    const section = content.sections.find((candidate) => candidate.id === annotation.sectionId);
    if (
      annotations.has(annotation.id) ||
      !section ||
      (annotation.questionId !== null &&
        !section.questions.some((question) => question.id === annotation.questionId))
    )
      return "Annotations need unique IDs and a target in the review.";
    annotations.add(annotation.id);
  }
  if (draft.remindAt !== null && Option.isNone(DateTime.make(draft.remindAt)))
    return "The reminder time must be a valid date.";
  return null;
}

function submissionMarkdown(review: ReviewArtifact): string {
  const lines = [`# Review: ${review.content.title}`, "", review.content.summary];
  for (const section of review.content.sections) {
    lines.push("", `## ${section.title}`);
    for (const question of section.questions) {
      lines.push("", `### ${question.prompt}`);
      const answer = review.draft.answers[question.id];
      if (!answer?.deferred && answer?.selectedOptionIds.length) {
        lines.push(
          "Selected:",
          ...question.options
            .filter((option) => answer.selectedOptionIds.includes(option.id))
            .map((option) => `- ${option.label} (${option.id})`),
        );
      }
      if (answer?.deferred) lines.push("Deferred for later.");
      if (answer?.notes.trim()) lines.push("Notes:", answer.notes.trim());
      if (!answer || (!answer.selectedOptionIds.length && !answer.deferred && !answer.notes.trim()))
        lines.push("Unanswered.");
    }
    for (const annotation of review.draft.annotations.filter(
      (entry) => entry.sectionId === section.id,
    )) {
      const target = section.questions.find(
        (question) => question.id === annotation.questionId,
      )?.prompt;
      lines.push("", target ? `Annotation on: ${target}` : "Section annotation:");
      if (annotation.quote !== null)
        lines.push(...annotation.quote.split("\n").map((line) => `> ${line}`));
      lines.push(annotation.body);
    }
  }
  if (review.draft.notes.trim()) lines.push("", "## Additional notes", review.draft.notes.trim());
  return lines.join("\n").trim();
}

const summary = (review: ReviewArtifact): ReviewSummary => ({
  id: review.id,
  threadId: review.threadId,
  title: review.content.title,
  revision: review.revision,
  lastSubmittedRevision: review.lastSubmission?.revision ?? null,
  remindAt: review.draft.remindAt,
  updatedAt: review.updatedAt,
});

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const lock = yield* Semaphore.make(1);
  const directory = path.join(config.stateDir, "review-artifacts");
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const thread = Effect.fn("ReviewArtifacts.thread")(function* (
    threadId: ReviewArtifact["threadId"],
  ) {
    const records = yield* orchestrator.getThreadRecords(threadId, []).pipe(
      Effect.mapError(
        (cause) =>
          new ReviewArtifactError({
            code: "thread",
            operation: "loadThread",
            message: "Could not load the review's thread.",
            cause,
          }),
      ),
    );
    if (records.thread.deletedAt !== null)
      return yield* new ReviewArtifactError({
        code: "thread",
        operation: "loadThread",
        message: "The review's thread was deleted.",
      });
    return records.thread;
  });
  const read = Effect.fn("ReviewArtifacts.read")(function* (reviewId: ReviewId) {
    if (Option.isNone(decodeId(reviewId)))
      return yield* new ReviewArtifactError({
        code: "invalid",
        operation: "read",
        message: "Invalid review ID.",
      });
    const contents = yield* fs.readFileString(path.join(directory, `${reviewId}.json`)).pipe(
      Effect.mapError(
        (cause) =>
          new ReviewArtifactError({
            code: cause.reason._tag === "NotFound" ? "not_found" : "storage",
            operation: "read",
            message: "Could not read the review.",
            reviewId,
            cause,
          }),
      ),
    );
    const { artifact } = yield* decodeReview(contents).pipe(
      Effect.mapError(
        (cause) =>
          new ReviewArtifactError({
            code: "storage",
            operation: "decode",
            message: "The saved review document is malformed.",
            reviewId,
            cause,
          }),
      ),
    );
    if (
      artifact.id !== reviewId ||
      contentError(artifact.content) !== null ||
      draftError(artifact.content, artifact.draft) !== null
    )
      return yield* new ReviewArtifactError({
        code: "storage",
        operation: "validate",
        message: "The saved review document is malformed.",
        reviewId,
      });
    return artifact;
  });
  const write = Effect.fn("ReviewArtifacts.write")(function* (artifact: ReviewArtifact) {
    const contents = yield* encodeReview({ formatVersion: 1, artifact }).pipe(
      Effect.mapError(
        (cause) =>
          new ReviewArtifactError({
            code: "storage",
            operation: "encode",
            message: "Could not encode the review.",
            reviewId: artifact.id,
            cause,
          }),
      ),
    );
    yield* writeFileStringAtomically({
      filePath: path.join(directory, `${artifact.id}.json`),
      contents,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) =>
          new ReviewArtifactError({
            code: "storage",
            operation: "write",
            message: "Could not save the review.",
            reviewId: artifact.id,
            cause,
          }),
      ),
    );
    return artifact;
  });
  const all = Effect.fn("ReviewArtifacts.all")(function* () {
    const files = yield* fs.readDirectory(directory).pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed([]),
      ),
      Effect.mapError(
        (cause) =>
          new ReviewArtifactError({
            code: "storage",
            operation: "list",
            message: "Could not list saved reviews.",
            cause,
          }),
      ),
    );
    const reviews: ReviewArtifact[] = [];
    for (const file of files.filter((file) => file.endsWith(".json")).sort()) {
      const id = decodeId(file.slice(0, -5));
      if (Option.isNone(id))
        return yield* new ReviewArtifactError({
          code: "storage",
          operation: "list",
          message: "A saved review has an invalid filename.",
        });
      reviews.push(yield* read(id.value));
    }
    return reviews;
  });
  const checkRevision = (review: ReviewArtifact, expectedRevision: number) =>
    review.revision === expectedRevision
      ? Effect.void
      : Effect.fail(
          new ReviewArtifactError({
            code: "conflict",
            message: "The review changed in another client. Reload it before saving.",
            reviewId: review.id,
            currentRevision: review.revision,
          }),
        );

  return ReviewArtifacts.of({
    create: Effect.fn("ReviewArtifacts.create")(function* (input) {
      yield* thread(input.threadId);
      const invalid = contentError(input.content);
      if (invalid !== null)
        return yield* new ReviewArtifactError({ code: "invalid", message: invalid });
      const timestamp = yield* now;
      return yield* write({
        id: ReviewId.make(yield* randomUuidV4),
        threadId: input.threadId,
        content: input.content,
        draft: { answers: {}, annotations: [], notes: "", remindAt: null },
        revision: 1,
        lastSubmission: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }, lock.withPermits(1)),
    get: Effect.fn("ReviewArtifacts.get")(function* ({ reviewId }) {
      const review = yield* read(reviewId);
      yield* thread(review.threadId);
      return review;
    }),
    getPublished: Effect.fn("ReviewArtifacts.getPublished")(function* ({ reviewId }) {
      const review = yield* read(reviewId);
      yield* thread(review.threadId);
      return {
        id: review.id,
        threadId: review.threadId,
        content: review.content,
        lastSubmission: review.lastSubmission,
      };
    }),
    list: Effect.fn("ReviewArtifacts.list")(function* ({ threadId }) {
      yield* thread(threadId);
      return (yield* all()).filter((review) => review.threadId === threadId).map(summary);
    }),
    save: Effect.fn("ReviewArtifacts.save")(function* ({ reviewId, expectedRevision, draft }) {
      const review = yield* read(reviewId);
      yield* thread(review.threadId);
      yield* checkRevision(review, expectedRevision);
      const invalid = draftError(review.content, draft);
      if (invalid !== null)
        return yield* new ReviewArtifactError({ code: "invalid", message: invalid, reviewId });
      return yield* write({
        ...review,
        draft,
        revision: review.revision + 1,
        updatedAt: yield* now,
      });
    }, lock.withPermits(1)),
    submit: Effect.fn("ReviewArtifacts.submit")(function* ({ reviewId, expectedRevision }) {
      const review = yield* read(reviewId);
      const owner = yield* thread(review.threadId);
      yield* checkRevision(review, expectedRevision);
      if (review.lastSubmission?.revision === review.revision) return review;
      if (
        !review.draft.notes.trim() &&
        review.draft.annotations.length === 0 &&
        !Object.values(review.draft.answers).some(
          (answer) => answer.selectedOptionIds.length > 0 || answer.notes.trim() || answer.deferred,
        )
      )
        return yield* new ReviewArtifactError({
          code: "invalid",
          operation: "submit",
          message: "Choose an answer, add a note, or defer a question before sending.",
          reviewId,
        });
      const markdown = submissionMarkdown(review);
      const messageId = MessageId.make(`review:${review.id}:${review.revision}`);
      yield* threads
        .sendToThread({
          projectId: owner.projectId,
          commandId: CommandId.make(`review-submit:${review.id}:${review.revision}`),
          threadId: review.threadId,
          messageId,
          text: markdown,
          attachments: [],
          mode: "queue",
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ReviewArtifactError({
                code: "send",
                operation: "submit",
                message: "Could not send the review to chat. Your draft is saved; retry sending.",
                reviewId,
                cause,
              }),
          ),
        );
      const submittedAt = yield* now;
      return yield* write({
        ...review,
        lastSubmission: { revision: review.revision, messageId, submittedAt, markdown },
        updatedAt: submittedAt,
      });
    }, lock.withPermits(1)),
    due: Effect.fn("ReviewArtifacts.due")(function* () {
      const timestamp = yield* DateTime.now;
      const due: ReviewSummary[] = [];
      for (const review of yield* all()) {
        if (review.lastSubmission?.revision === review.revision) continue;
        const remindAt =
          review.draft.remindAt === null ? Option.none() : DateTime.make(review.draft.remindAt);
        if (
          Option.isNone(remindAt) ||
          DateTime.toEpochMillis(remindAt.value) > DateTime.toEpochMillis(timestamp)
        )
          continue;
        const owner = yield* orchestrator.getThreadRecords(review.threadId, []).pipe(
          Effect.asSome,
          Effect.catchIf(
            (cause) => cause._tag === "OrchestratorProjectionError" && isMissingThread(cause.cause),
            () => Effect.succeedNone,
          ),
          Effect.mapError(
            (cause) =>
              new ReviewArtifactError({
                code: "thread",
                operation: "due",
                message: "Could not load the reminder thread.",
                reviewId: review.id,
                cause,
              }),
          ),
        );
        if (Option.isSome(owner) && owner.value.thread.deletedAt === null)
          due.push(summary(review));
      }
      return due;
    }),
  });
});
export const layer = Layer.effect(ReviewArtifacts, make);
