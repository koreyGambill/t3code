import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  MessageId,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const ReviewId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
).pipe(Schema.brand("ReviewId"));
export type ReviewId = typeof ReviewId.Type;
export const ReviewOption = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.String,
});
export type ReviewOption = typeof ReviewOption.Type;
export const ReviewQuestion = Schema.Struct({
  id: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  context: Schema.String,
  recommendation: Schema.String,
  recommendedOptionId: Schema.NullOr(TrimmedNonEmptyString),
  options: Schema.Array(ReviewOption),
  multiSelect: Schema.Boolean,
});
export type ReviewQuestion = typeof ReviewQuestion.Type;
export const ReviewSection = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  markdown: Schema.String,
  questions: Schema.Array(ReviewQuestion),
});
export type ReviewSection = typeof ReviewSection.Type;
export const ReviewContent = Schema.Struct({
  title: TrimmedNonEmptyString,
  summary: Schema.String,
  sections: Schema.Array(ReviewSection),
});
export type ReviewContent = typeof ReviewContent.Type;
export const ReviewAnswer = Schema.Struct({
  selectedOptionIds: Schema.Array(TrimmedNonEmptyString),
  notes: Schema.String,
  deferred: Schema.Boolean,
});
export type ReviewAnswer = typeof ReviewAnswer.Type;
export const ReviewAnnotation = Schema.Struct({
  id: TrimmedNonEmptyString,
  sectionId: TrimmedNonEmptyString,
  questionId: Schema.NullOr(TrimmedNonEmptyString),
  quote: Schema.NullOr(Schema.String),
  body: TrimmedNonEmptyString,
});
export type ReviewAnnotation = typeof ReviewAnnotation.Type;
export const ReviewDraft = Schema.Struct({
  answers: Schema.Record(Schema.String, ReviewAnswer),
  annotations: Schema.Array(ReviewAnnotation),
  notes: Schema.String,
  remindAt: Schema.NullOr(IsoDateTime),
});
export type ReviewDraft = typeof ReviewDraft.Type;
export const ReviewSubmission = Schema.Struct({
  revision: PositiveInt,
  messageId: MessageId,
  submittedAt: IsoDateTime,
  markdown: Schema.String,
});
export type ReviewSubmission = typeof ReviewSubmission.Type;
export const ReviewArtifact = Schema.Struct({
  id: ReviewId,
  threadId: ThreadId,
  content: ReviewContent,
  draft: ReviewDraft,
  revision: PositiveInt,
  lastSubmission: Schema.NullOr(ReviewSubmission),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReviewArtifact = typeof ReviewArtifact.Type;
export const ReviewSummary = Schema.Struct({
  id: ReviewId,
  threadId: ThreadId,
  title: Schema.String,
  revision: PositiveInt,
  lastSubmittedRevision: Schema.NullOr(PositiveInt),
  remindAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type ReviewSummary = typeof ReviewSummary.Type;
export const ReviewPublished = Schema.Struct({
  id: ReviewId,
  threadId: ThreadId,
  content: ReviewContent,
  lastSubmission: Schema.NullOr(ReviewSubmission),
});
export type ReviewPublished = typeof ReviewPublished.Type;
export const ReviewCreateInput = Schema.Struct({ threadId: ThreadId, content: ReviewContent });
export type ReviewCreateInput = typeof ReviewCreateInput.Type;
export const ReviewListInput = Schema.Struct({ threadId: ThreadId });
export type ReviewListInput = typeof ReviewListInput.Type;
export const ReviewGetInput = Schema.Struct({ reviewId: ReviewId });
export type ReviewGetInput = typeof ReviewGetInput.Type;
export const ReviewSaveInput = Schema.Struct({
  reviewId: ReviewId,
  expectedRevision: PositiveInt,
  draft: ReviewDraft,
});
export type ReviewSaveInput = typeof ReviewSaveInput.Type;
export const ReviewSubmitInput = Schema.Struct({
  reviewId: ReviewId,
  expectedRevision: PositiveInt,
});
export type ReviewSubmitInput = typeof ReviewSubmitInput.Type;
export const ReviewDueInput = Schema.Struct({});

export class ReviewArtifactError extends Schema.TaggedError<ReviewArtifactError>()(
  "ReviewArtifactError",
  {
    code: Schema.Literals(["not_found", "invalid", "conflict", "storage", "thread", "send"]),
    message: Schema.String,
    reviewId: Schema.optional(ReviewId),
    currentRevision: Schema.optional(PositiveInt),
    operation: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
