import { expect, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type ReviewContent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { emptyProjection } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Reviews from "./ReviewArtifacts.ts";

const threadId = ThreadId.make("review-thread");
const at = DateTime.makeUnsafe("2026-11-05T12:00:00.000Z");
const content: ReviewContent = {
  title: "Database design",
  summary: "Choose a direction",
  sections: [
    {
      id: "storage",
      title: "Storage",
      markdown: "Two choices",
      questions: [
        {
          id: "engine",
          prompt: "Which engine?",
          context: "Keep it simple",
          recommendation: "Use SQLite",
          recommendedOptionId: "sqlite",
          multiSelect: false,
          options: [
            { id: "sqlite", label: "SQLite", description: "Local" },
            { id: "postgres", label: "Postgres", description: "Shared" },
          ],
        },
        {
          id: "later",
          prompt: "Next step?",
          context: "",
          recommendation: "",
          recommendedOptionId: null,
          multiSelect: false,
          options: [],
        },
      ],
    },
  ],
};

const harness = Effect.fn("test.reviewHarness")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "review-artifacts-test-" });
  const configContext = yield* Layer.build(ServerConfig.layerTest(root, root));
  const config = Context.get(configContext, ServerConfig.ServerConfig);
  const projection = emptyProjection({
    id: EventId.make("created"),
    type: "thread.created",
    threadId,
    occurredAt: at,
    payload: {
      id: threadId,
      createdBy: "user",
      creationSource: "web",
      projectId: ProjectId.make("project"),
      title: "Thread",
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "default" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      deletedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
    },
  });
  let deleted = false;
  let failAfterAccept = false;
  const accepted = new Map<string, ThreadManagement.ThreadManagementSendInput>();
  const attempts: ThreadManagement.ThreadManagementSendInput[] = [];
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  let pause = false;
  const send: ThreadManagement.ThreadManagementService["Service"]["sendToThread"] = Effect.fn(
    "test.sendReview",
  )(function* (input) {
    attempts.push(input);
    if (!accepted.has(input.commandId)) accepted.set(input.commandId, input);
    if (pause) {
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    }
    if (failAfterAccept) {
      failAfterAccept = false;
      return yield* new ThreadManagement.ThreadManagementThreadArchivedError({ threadId });
    }
    const message: OrchestrationV2ConversationMessage = {
      id: input.messageId,
      threadId,
      runId: RunId.make("review-run"),
      nodeId: null,
      role: "user",
      createdBy: "user",
      creationSource: "web",
      text: input.text,
      attachments: [],
      streaming: false,
      createdAt: at,
      updatedAt: at,
    };
    const run: OrchestrationV2Run = {
      id: RunId.make("review-run"),
      threadId,
      ordinal: 1,
      providerInstanceId: projection.thread.providerInstanceId,
      modelSelection: projection.thread.modelSelection,
      providerThreadId: null,
      userMessageId: input.messageId,
      rootNodeId: null,
      activeAttemptId: null,
      status: "queued",
      requestedAt: at,
      startedAt: null,
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    };
    return {
      dispatch: { sequence: 1, storedEvents: [] },
      projection: { thread: projection.thread, runs: [run], messages: [message], turnItems: [] },
      message,
      run,
      turnItem: null,
      delivery: "queued",
    };
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(ServerConfig.ServerConfig, config),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadRecords: () =>
        Effect.succeed({
          ...projection,
          thread: { ...projection.thread, deletedAt: deleted ? at : null },
        }),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({ sendToThread: send }),
  );
  const open = Effect.fn("test.openReviews")(function* () {
    const context = yield* Layer.build(
      Layer.fresh(Reviews.layer).pipe(Layer.provide(dependencies)),
    );
    return Context.get(context, Reviews.ReviewArtifacts);
  });
  const service = yield* open();
  return {
    service,
    open,
    fs,
    path,
    directory: path.join(config.stateDir, "review-artifacts"),
    attempts,
    accepted,
    setDeleted: () => {
      deleted = true;
    },
    failNext: () => {
      failAfterAccept = true;
    },
    pauseSend: () => {
      pause = true;
    },
    entered,
    release,
  };
});

it.effect(
  "persists drafts across service reconstruction, rejects stale edits and hides drafts from agents",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const review = yield* h.service.create({ threadId, content });
      expect(review.draft.answers).toEqual({});
      const saved = yield* h.service.save({
        reviewId: review.id,
        expectedRevision: 1,
        draft: {
          ...review.draft,
          notes: "private thought",
          answers: { engine: { selectedOptionIds: ["postgres"], notes: "why", deferred: false } },
        },
      });
      const reopened = yield* h.open();
      expect(yield* reopened.get({ reviewId: review.id })).toEqual(saved);
      const stale = yield* Effect.result(
        reopened.save({ reviewId: review.id, expectedRevision: 1, draft: review.draft }),
      );
      expect(Result.isFailure(stale) && stale.failure.code).toBe("conflict");
      expect(yield* reopened.getPublished({ reviewId: review.id })).toEqual({
        id: review.id,
        threadId,
        content,
        lastSubmission: null,
      });
      expect((yield* reopened.list({ threadId })).map((entry) => entry.id)).toEqual([review.id]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "sends explicit answers once, retries an accepted send and keeps later edits unsent",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const review = yield* h.service.create({ threadId, content });
      const saved = yield* h.service.save({
        reviewId: review.id,
        expectedRevision: 1,
        draft: {
          ...review.draft,
          answers: {
            engine: {
              selectedOptionIds: ["postgres"],
              notes: "Use the shared service",
              deferred: false,
            },
            later: { selectedOptionIds: [], notes: "", deferred: true },
          },
          annotations: [
            {
              id: "note",
              sectionId: "storage",
              questionId: "engine",
              quote: "Keep it simple",
              body: "Check operations cost",
            },
          ],
        },
      });
      h.failNext();
      expect(
        Result.isFailure(
          yield* Effect.result(
            h.service.submit({ reviewId: review.id, expectedRevision: saved.revision }),
          ),
        ),
      ).toBe(true);
      const sent = yield* h.service.submit({
        reviewId: review.id,
        expectedRevision: saved.revision,
      });
      yield* h.service.submit({ reviewId: review.id, expectedRevision: saved.revision });
      expect(h.accepted.size).toBe(1);
      expect(h.attempts.length).toBe(2);
      expect(sent.lastSubmission?.markdown).toContain("Postgres (postgres)");
      expect(sent.lastSubmission?.markdown).not.toContain("SQLite (sqlite)");
      expect(sent.lastSubmission?.markdown).toContain("Deferred for later.");
      expect(sent.lastSubmission?.markdown).toContain("Check operations cost");
      const edit = yield* h.service.save({
        reviewId: review.id,
        expectedRevision: saved.revision,
        draft: { ...saved.draft, notes: "not sent yet" },
      });
      expect(edit.lastSubmission).toEqual(sent.lastSubmission);
      expect(edit.revision).toBe(saved.revision + 1);
      expect(h.accepted.size).toBe(1);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("serializes a save behind submission without dropping the accepted snapshot", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const review = yield* h.service.create({ threadId, content });
    const saved = yield* h.service.save({
      reviewId: review.id,
      expectedRevision: 1,
      draft: { ...review.draft, notes: "first" },
    });
    h.pauseSend();
    const submit = yield* h.service
      .submit({ reviewId: review.id, expectedRevision: saved.revision })
      .pipe(Effect.forkChild);
    yield* Deferred.await(h.entered);
    const save = yield* h.service
      .save({
        reviewId: review.id,
        expectedRevision: saved.revision,
        draft: { ...saved.draft, notes: "new draft" },
      })
      .pipe(Effect.forkChild);
    yield* Deferred.succeed(h.release, undefined);
    const sent = yield* Fiber.join(submit);
    const edited = yield* Fiber.join(save);
    expect(edited.draft.notes).toBe("new draft");
    expect(edited.lastSubmission).toEqual(sent.lastSubmission);
    expect(edited.lastSubmission?.markdown).toContain("first");
    expect(edited.lastSubmission?.markdown).not.toContain("new draft");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "validates stable targets and explicit submission, and never resets a corrupt document",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const review = yield* h.service.create({ threadId, content });
      expect(
        Result.isFailure(
          yield* Effect.result(h.service.submit({ reviewId: review.id, expectedRevision: 1 })),
        ),
      ).toBe(true);
      expect(
        Result.isFailure(
          yield* Effect.result(
            h.service.create({
              threadId,
              content: { ...content, sections: [...content.sections, ...content.sections] },
            }),
          ),
        ),
      ).toBe(true);
      const invalid = {
        ...review.draft,
        answers: { engine: { selectedOptionIds: ["missing"], notes: "", deferred: false } },
      };
      expect(
        Result.isFailure(
          yield* Effect.result(
            h.service.save({ reviewId: review.id, expectedRevision: 1, draft: invalid }),
          ),
        ),
      ).toBe(true);
      const file = h.path.join(h.directory, `${review.id}.json`);
      yield* h.fs.writeFileString(file, "broken");
      const result = yield* Effect.result(h.service.get({ reviewId: review.id }));
      expect(Result.isFailure(result) && result.failure.code).toBe("storage");
      expect(Result.isFailure(result) && result.failure.cause !== undefined).toBe(true);
      expect(yield* h.fs.readFileString(file)).toBe("broken");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "returns overdue reminders after restart, clears them on save and excludes deleted threads",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const review = yield* h.service.create({ threadId, content });
      const saved = yield* h.service.save({
        reviewId: review.id,
        expectedRevision: 1,
        draft: { ...review.draft, remindAt: "1970-01-01T00:00:00.000Z" },
      });
      const reopened = yield* h.open();
      expect((yield* reopened.due()).map((entry) => entry.id)).toEqual([review.id]);
      const clear = yield* reopened.save({
        reviewId: review.id,
        expectedRevision: saved.revision,
        draft: { ...saved.draft, remindAt: null },
      });
      expect(yield* reopened.due()).toEqual([]);
      yield* reopened.save({
        reviewId: review.id,
        expectedRevision: clear.revision,
        draft: saved.draft,
      });
      h.setDeleted();
      expect(yield* reopened.due()).toEqual([]);
      expect(h.accepted.size).toBe(0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "defers a selected option without approving it and restores that draft choice on resume",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const review = yield* h.service.create({ threadId, content });
      const draft = {
        ...review.draft,
        remindAt: "1970-01-01T00:00:00.000Z",
        answers: {
          engine: { selectedOptionIds: ["sqlite"], notes: "Need time to check", deferred: true },
        },
      };
      const saved = yield* h.service.save({ reviewId: review.id, expectedRevision: 1, draft });
      const deferred = yield* h.service.submit({
        reviewId: review.id,
        expectedRevision: saved.revision,
      });
      expect(deferred.draft).toEqual(draft);
      expect(deferred.lastSubmission?.markdown).toContain("Deferred for later.");
      expect(deferred.lastSubmission?.markdown).toContain("Need time to check");
      expect(deferred.lastSubmission?.markdown).not.toContain("SQLite (sqlite)");
      expect(yield* h.service.due()).toEqual([]);
      const resumed = yield* h.service.save({
        reviewId: review.id,
        expectedRevision: saved.revision,
        draft: { ...draft, answers: { engine: { ...draft.answers.engine, deferred: false } } },
      });
      const sent = yield* h.service.submit({
        reviewId: review.id,
        expectedRevision: resumed.revision,
      });
      expect(sent.lastSubmission?.markdown).toContain("SQLite (sqlite)");
      expect(h.accepted.size).toBe(2);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("accepts only one simultaneous save at the same revision", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const review = yield* h.service.create({ threadId, content });
    const results = yield* Effect.forEach(
      ["one", "two"],
      (notes) =>
        Effect.result(
          h.service.save({
            reviewId: review.id,
            expectedRevision: 1,
            draft: { ...review.draft, notes },
          }),
        ),
      { concurrency: "unbounded" },
    );
    expect(results.filter(Result.isSuccess)).toHaveLength(1);
    expect(results.filter(Result.isFailure).map((result) => result.failure.code)).toEqual([
      "conflict",
    ]);
    expect((yield* h.service.get({ reviewId: review.id })).revision).toBe(2);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
