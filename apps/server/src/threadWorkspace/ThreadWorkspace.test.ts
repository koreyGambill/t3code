// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  RunId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import {
  emptyProjection,
  ProjectionStoreThreadNotFoundError,
} from "../orchestration-v2/ProjectionStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Workspaces from "./ThreadWorkspace.ts";

const threadId = ThreadId.make("import:claude:../../workspace");
const at = DateTime.makeUnsafe("2026-11-05T12:00:00.000Z");
const item = {
  id: "decision",
  title: "Choose a direction",
  details: "Need input",
  status: "open",
} as const;
const harness = Effect.fn("test.workspaceHarness")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "thread-workspace-test-" });
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
  let threadFailure: Orchestrator.OrchestratorProjectionError | null = null;
  const attempts: ThreadManagement.ThreadManagementSendInput[] = [];
  let failSend = false;
  const send: ThreadManagement.ThreadManagementService["Service"]["sendToThread"] = Effect.fn(
    "test.sendWorkspace",
  )(function* (input) {
    attempts.push(input);
    if (failSend) {
      failSend = false;
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
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("test-environment")),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({ sendToThread: send }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadRecords: () =>
        threadFailure !== null
          ? Effect.fail(threadFailure)
          : Effect.succeed({
              ...projection,
              thread: { ...projection.thread, deletedAt: deleted ? at : null },
            }),
    }),
  );
  const open = Effect.fn("test.openWorkspace")(function* () {
    const context = yield* Layer.build(
      Layer.fresh(Workspaces.layer).pipe(Layer.provide(dependencies)),
    );
    return Context.get(context, Workspaces.ThreadWorkspace);
  });
  return {
    service: yield* open(),
    attempts,
    failSend: () => {
      failSend = true;
    },
    open,
    fs,
    path,
    directory: path.join(config.stateDir, "thread-workspaces"),
    file: path.join(
      config.stateDir,
      "thread-workspaces",
      `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`,
    ),
    setDeleted: () => {
      deleted = true;
    },
    setThreadFailure: (failure: typeof threadFailure) => {
      threadFailure = failure;
    },
  };
});

it.effect(
  "persists partial edits across reconstruction and rejects stale writes without losing other sections",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      expect(yield* h.service.get({ threadId })).toEqual(Workspaces.emptyWorkspace(threadId));
      expect(yield* h.fs.exists(h.directory)).toBe(true);
      const saved = yield* h.service.patch({
        threadId,
        expectedRevision: 0,
        actionItems: [item],
        designNotes: "Use a small module",
      });
      expect(saved.revision).toBe(1);
      expect(saved.updatedAt).not.toBeNull();
      const reopened = yield* h.open();
      expect(yield* reopened.get({ threadId })).toEqual(saved);
      const next = yield* reopened.patch({
        threadId,
        expectedRevision: 1,
        summaryNotes: "Direction chosen",
        actionItems: [{ ...item, status: "deferred" }],
      });
      expect(next.designNotes).toBe(saved.designNotes);
      expect(next.actionItems[0]?.status).toBe("deferred");
      const stale = yield* Effect.result(
        reopened.patch({ threadId, expectedRevision: 1, designNotes: "Overwrite" }),
      );
      expect(stale).toMatchObject({
        _tag: "Failure",
        failure: { code: "conflict", currentRevision: 2 },
      });
      expect(yield* reopened.get({ threadId })).toEqual(next);
      expect(yield* h.fs.readDirectory(h.directory)).toEqual([
        `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`,
      ]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("serializes simultaneous compare-and-save edits", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const results = yield* Effect.forEach(
      ["one", "two"],
      (summaryNotes) =>
        Effect.result(h.service.patch({ threadId, expectedRevision: 0, summaryNotes })),
      { concurrency: "unbounded" },
    );
    expect(results.filter(Result.isSuccess)).toHaveLength(1);
    expect(results.filter(Result.isFailure).map((result) => result.failure.code)).toEqual([
      "conflict",
    ]);
    expect((yield* h.service.get({ threadId })).revision).toBe(1);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "rejects duplicate action IDs and malformed saved documents instead of resetting them",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const invalid = yield* Effect.result(
        h.service.patch({ threadId, expectedRevision: 0, actionItems: [item, item] }),
      );
      expect(invalid).toMatchObject({ _tag: "Failure", failure: { code: "invalid" } });
      expect(yield* h.fs.exists(h.directory)).toBe(true);
      const saved = yield* h.service.patch({ threadId, expectedRevision: 0, actionItems: [item] });
      for (const contents of [
        "{bad json",
        JSON.stringify({ formatVersion: 1, workspace: { ...saved, threadId: "another-thread" } }),
        JSON.stringify({ formatVersion: 1, workspace: { ...saved, actionItems: [item, item] } }),
      ]) {
        yield* h.fs.writeFileString(h.file, contents);
        const failure = yield* Effect.result(h.service.get({ threadId }));
        expect(failure).toMatchObject({ _tag: "Failure", failure: { code: "storage" } });
        expect(yield* h.fs.readFileString(h.file)).toBe(contents);
      }
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "rejects deleted or missing threads and preserves unexpected thread and storage failures",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const missing = new Orchestrator.OrchestratorProjectionError({
        threadId,
        cause: new ProjectionStoreThreadNotFoundError({ threadId }),
      });
      h.setThreadFailure(missing);
      expect(yield* Effect.result(h.service.get({ threadId }))).toMatchObject({
        _tag: "Failure",
        failure: { code: "not_found", cause: missing },
      });
      const broken = new Orchestrator.OrchestratorProjectionError({
        threadId,
        cause: new Error("database unavailable"),
      });
      h.setThreadFailure(broken);
      expect(
        yield* Effect.result(
          h.service.patch({ threadId, expectedRevision: 0, summaryNotes: "No" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "thread", cause: broken } });
      h.setThreadFailure(null);
      yield* h.fs.writeFileString(h.directory, "blocks directory creation");
      expect(
        yield* Effect.result(
          h.service.patch({ threadId, expectedRevision: 0, summaryNotes: "No" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "storage", cause: expect.anything() } });
      h.setDeleted();
      expect(yield* Effect.result(h.service.get({ threadId }))).toMatchObject({
        _tag: "Failure",
        failure: { code: "not_found" },
      });
      expect(
        yield* Effect.result(
          h.service.patch({ threadId, expectedRevision: 0, summaryNotes: "No" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "not_found" } });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "keeps item identities and private answers through grouped model edits, and rejects broken trees",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const group = yield* h.service.mutate({
        threadId,
        expectedRevision: 0,
        changes: [{ kind: "group", title: "CLI design" }],
      });
      const groupId = group.groups.find((group) => group.title === "CLI design")!.id;
      const created = yield* h.service.mutate({
        threadId,
        expectedRevision: 1,
        changes: [
          {
            kind: "question",
            groupId,
            title: "What should a profile control?",
            options: [
              { id: "storage", label: "Storage", description: "Local execution" },
              { id: "execution", label: "Execution", description: "Remote execution" },
            ],
            recommendedOptionIds: ["storage"],
            recommendation: "Keep execution explicit.",
          },
          { kind: "action", groupId, title: "Check the command examples" },
          {
            kind: "design",
            groupId,
            title: "Execution boundary",
            markdown: "Keep the contract clear.",
          },
        ],
      });
      const question = created.items.find((item) => item.kind === "question")!;
      expect(question.ref).toMatch(/^Q-[A-F0-9]{6}$/);
      expect(
        (yield* h.service.query({
          threadId,
          section: "questions",
          itemIds: [question.ref],
        })).questions?.map((item) => item.id),
      ).toEqual([question.id]);
      let current = yield* h.service.saveDraft({
        threadId,
        expectedRevision: 2,
        userDraft: {
          questionAnswers: {
            [question.id]: { selectedOptionIds: ["execution"], notes: "My private reasoning" },
          },
          actionNotes: {},
        },
      });
      const index = yield* h.service.query({ threadId });
      expect(index).not.toHaveProperty("userDraft");
      expect(JSON.stringify(index)).not.toContain("My private reasoning");
      yield* h.service.mutate({
        threadId,
        expectedRevision: current.revision,
        changes: [
          { kind: "question", id: question.ref, groupId: "ungrouped", title: "Profile meaning?" },
        ],
      });
      current = yield* h.service.get({ threadId });
      expect(current.questions[0]).toMatchObject({
        id: question.id,
        ref: question.ref,
        groupId: "ungrouped",
        title: "Profile meaning?",
        recommendedOptionIds: ["storage"],
      });
      expect(current.userDraft.questionAnswers[question.id]?.notes).toBe("My private reasoning");
      for (const groups of [
        [
          { id: "ungrouped", parentId: null, title: "Ungrouped" },
          { id: "cycle", parentId: "cycle", title: "Cycle" },
        ],
        [
          { id: "ungrouped", parentId: null, title: "Ungrouped" },
          { id: "orphan", parentId: "missing", title: "Orphan" },
        ],
      ]) {
        expect(
          yield* Effect.result(
            h.service.patch({ threadId, expectedRevision: current.revision, groups }),
          ),
        ).toMatchObject({ _tag: "Failure", failure: { code: "invalid" } });
      }
      expect(
        yield* Effect.result(
          h.service.mutate({
            threadId,
            expectedRevision: current.revision,
            changes: [{ kind: "group", id: groupId, remove: true }],
          }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "invalid" } });
      expect(
        yield* Effect.result(
          h.service.saveDraft({
            threadId,
            expectedRevision: current.revision,
            userDraft: {
              questionAnswers: {
                [question.id]: { selectedOptionIds: ["storage", "execution"], notes: "" },
              },
              actionNotes: {},
            },
          }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "invalid" } });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "submits only explicit selected feedback with native source records and retries the same command",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const created = yield* h.service.mutate({
        threadId,
        expectedRevision: 0,
        changes: [
          {
            kind: "question",
            title: "Which rollout?",
            options: [
              { id: "slow", label: "Gradual", description: "" },
              { id: "fast", label: "Immediate", description: "" },
            ],
            recommendedOptionIds: ["slow"],
            recommendation: "Gradual is easier to monitor.",
          },
          { kind: "question", title: "Recovery?" },
          { kind: "action", title: "Confirm owner" },
          { kind: "action", title: "Completed check", status: "done" },
        ],
      });
      const question = created.items.find((item) => item.kind === "question")!;
      const other = created.items.find((item) => item.title === "Recovery?")!;
      const action = created.items.find((item) => item.kind === "action")!;
      expect(
        yield* Effect.result(
          h.service.submit({ threadId, expectedRevision: 1, itemIds: [question.id] }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "invalid" } });
      const saved = yield* h.service.saveDraft({
        threadId,
        expectedRevision: 1,
        userDraft: {
          questionAnswers: {
            [question.id]: {
              selectedOptionIds: ["fast"],
              notes: "Use the short maintenance window.",
            },
            [other.id]: { selectedOptionIds: [], notes: "Private undecided note" },
          },
          actionNotes: { [action.id]: "Private owner note" },
        },
      });
      expect(yield* h.service.counts({ threadId })).toEqual({
        questions: 2,
        unansweredQuestions: 0,
        actions: 2,
        outstandingActions: 1,
        designs: 0,
        relatedThreads: 0,
      });
      h.failSend();
      expect(
        yield* Effect.result(
          h.service.submit({ threadId, expectedRevision: saved.revision, itemIds: [question.id] }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "send" } });
      const sent = yield* h.service.submit({
        threadId,
        expectedRevision: saved.revision,
        itemIds: [question.id],
      });
      expect(h.attempts).toHaveLength(2);
      expect(h.attempts[0]?.commandId).toBe(h.attempts[1]?.commandId);
      expect(h.attempts[1]?.text).toContain("Answer: Immediate");
      expect(h.attempts[1]?.text).not.toContain("Private undecided note");
      expect(h.attempts[1]?.text).not.toContain("Private owner note");
      expect(h.attempts[1]?.context?.records).toMatchObject([
        { kind: "thread", threadId, workspaceItemId: question.id, workspaceSection: "questions" },
      ]);
      expect(sent.userDraft).toEqual(saved.userDraft);
      yield* h.service.submit({
        threadId,
        expectedRevision: saved.revision,
        itemIds: [question.id],
      });
      expect(h.attempts).toHaveLength(2);
      const detail = yield* h.service.query({
        threadId,
        section: "questions",
        itemIds: [question.id],
      });
      expect(detail.questions).toHaveLength(1);
      expect(detail.submissions?.[0]?.markdown).toContain("Immediate");
      expect(JSON.stringify(detail)).not.toContain("Private undecided note");
      expect(
        (yield* h.service.submit({ threadId, expectedRevision: saved.revision, itemIds: [] }))
          .submissions,
      ).toHaveLength(2);
      expect(h.attempts.at(-1)?.text).toContain("Private owner note");
      expect(h.attempts.at(-1)?.text).toContain("Action: Completed check\nStatus: done");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "migrates legacy workspace and review answers without modifying legacy review files",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.fs.makeDirectory(h.directory, { recursive: true });
      yield* h.fs.writeFileString(
        h.file,
        JSON.stringify({
          formatVersion: 1,
          workspace: {
            threadId,
            revision: 5,
            actionItems: [item],
            designNotes: "Earlier design",
            summaryNotes: "Earlier context",
            updatedAt: null,
          },
        }),
      );
      const reviews = h.path.join(h.path.dirname(h.directory), "review-artifacts");
      yield* h.fs.makeDirectory(reviews);
      const legacyReview = JSON.stringify({
        formatVersion: 1,
        artifact: {
          id: "00000000-0000-4000-8000-000000000001",
          threadId,
          content: {
            title: "Earlier review",
            summary: "Context",
            sections: [
              {
                id: "cli",
                title: "CLI design",
                markdown: "Design context",
                questions: [
                  {
                    id: "profile",
                    prompt: "Profile contract?",
                    context: "Choose carefully",
                    recommendation: "Use storage",
                    recommendedOptionId: "storage",
                    options: [{ id: "storage", label: "Storage", description: "" }],
                    multiSelect: false,
                  },
                ],
              },
            ],
          },
          draft: {
            answers: {
              profile: { selectedOptionIds: ["storage"], notes: "Private answer", deferred: true },
            },
            annotations: [],
            notes: "",
            remindAt: null,
          },
          revision: 1,
          lastSubmission: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      });
      const reviewPath = h.path.join(reviews, "00000000-0000-4000-8000-000000000001.json");
      yield* h.fs.writeFileString(reviewPath, legacyReview.slice(0, -1));
      expect(yield* Effect.result(h.service.get({ threadId }))).toMatchObject({
        _tag: "Failure",
        failure: { code: "storage", operation: "migrateReviews" },
      });
      expect(yield* h.fs.readFileString(reviewPath)).toBe(legacyReview.slice(0, -1));
      yield* h.fs.writeFileString(reviewPath, legacyReview);
      yield* h.fs.writeFileString(
        h.path.join(reviews, "00000000-0000-4000-8000-000000000002.json"),
        '{"artifact":{"threadId":"another-thread","broken":',
      );
      const migrated = yield* h.service.get({ threadId });
      expect(migrated.revision).toBe(5);
      expect(migrated.designNotes).toBe("");
      expect(yield* h.fs.readFileString(h.file)).toContain('"formatVersion":2');
      yield* h.fs.writeFileString(reviewPath, "{broken after migration");
      expect(yield* h.service.get({ threadId })).toEqual(migrated);
      yield* h.fs.writeFileString(reviewPath, legacyReview);

      expect(migrated.actionItems[0]).toMatchObject({
        ...item,
        ref: expect.stringMatching(/^A-/),
        groupId: "ungrouped",
      });
      expect(migrated.designDocuments).toHaveLength(2);
      expect(migrated.questions[0]?.title).toBe("Profile contract?");
      expect(Object.values(migrated.userDraft.questionAnswers)[0]).toEqual({
        selectedOptionIds: ["storage"],
        notes: "Previously deferred.\n\nPrivate answer",
      });
      const saved = yield* h.service.patch({
        threadId,
        expectedRevision: 5,
        summaryNotes: "Current state",
      });
      expect(yield* (yield* h.open()).get({ threadId })).toEqual(saved);
      expect(yield* h.fs.readFileString(reviewPath)).toBe(legacyReview);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
