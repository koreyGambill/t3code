// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  isIndependentVerification,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  RunId,
  CheckpointId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { formatWorkspaceFeedback } from "@t3tools/shared/workspaceFeedback";
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
  const messages: OrchestrationV2ConversationMessage[] = [];
  const runs: OrchestrationV2Run[] = [];
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
      ...(input.context === undefined ? {} : { context: input.context }),
      attachments: [],
      streaming: false,
      createdAt: at,
      updatedAt: at,
    };
    messages.push(message);
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
      getThreadRecords: (requestedThreadId) =>
        threadFailure !== null
          ? Effect.fail(threadFailure)
          : Effect.succeed({
              ...projection,
              messages,
              runs,
              thread: {
                ...projection.thread,
                id: requestedThreadId,
                archivedAt: at,
                settledAt: at,
                deletedAt: deleted ? at : null,
              },
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
    addRun: (run: OrchestrationV2Run) => runs.push(run),
    attempts,
    sendFromComposer: (
      text: string,
      context: ThreadManagement.ThreadManagementSendInput["context"],
    ) =>
      send({
        projectId: projection.thread.projectId,
        commandId: CommandId.make(`composer-${messages.length}`),
        threadId,
        messageId: MessageId.make(`composer-${messages.length}`),
        text,
        ...(context === undefined ? {} : { context }),
        attachments: [],
        mode: "queue",
        createdBy: "user",
        creationSource: "web",
      }),
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

it.effect("context marks persist a fixed run through renames and later turns", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const sent = yield* h.sendFromComposer("Scout findings", undefined);
    const first = {
      ...sent.run,
      status: "completed" as const,
      checkpointId: CheckpointId.make("mark-first-checkpoint"),
    };
    h.addRun(first);
    const marked = yield* h.service.patch({
      threadId,
      expectedRevision: 0,
      changes: [{ kind: "mark", name: "scout final", contextSource: {} }],
    });
    const mark = marked.markAnnotations[0]!;
    expect(mark.contextSource).toEqual({
      threadId,
      runId: first.id,
      checkpointId: first.checkpointId,
    });
    h.addRun({ ...first, id: RunId.make("mark-later-run"), ordinal: 2 });
    const renamed = yield* h.service.patch({
      threadId,
      expectedRevision: marked.revision,
      changes: [{ kind: "mark", url: mark.url, name: "ready for workers" }],
    });
    const reopened = yield* h.open();
    expect((yield* reopened.get({ threadId })).markAnnotations).toEqual(renamed.markAnnotations);
    expect(renamed.markAnnotations[0]?.contextSource).toEqual(mark.contextSource);
    const moved = yield* h.service
      .patch({
        threadId,
        expectedRevision: renamed.revision,
        changes: [{ kind: "mark", url: mark.url, contextSource: {} }],
      })
      .pipe(Effect.flip);
    expect(moved.code).toBe("invalid");
    const ambiguous = yield* h.service
      .patch({
        threadId,
        expectedRevision: renamed.revision,
        changes: [
          {
            kind: "mark",
            name: "ambiguous",
            contextSource: {
              runId: first.id,
              checkpointId: CheckpointId.make("another-checkpoint"),
            },
          },
        ],
      })
      .pipe(Effect.flip);
    expect(ambiguous.code).toBe("invalid");
    const removed = yield* h.service.patch({
      threadId,
      expectedRevision: renamed.revision,
      changes: [{ kind: "mark", url: mark.url, remove: true }],
    });
    expect(removed.markAnnotations).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "persists partial edits across reconstruction and rejects stale writes to the same field",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      expect(yield* h.service.get({ threadId })).toEqual(Workspaces.emptyWorkspace(threadId));
      expect(yield* h.fs.exists(h.directory)).toBe(true);
      const saved = yield* h.service.patch({
        threadId,
        expectedRevision: 0,
        changes: [{ kind: "action", title: item.title, details: item.details }],
        summaryNotes: "Use a small module",
      });
      expect(saved.revision).toBe(1);
      expect(saved.updatedAt).not.toBeNull();
      const actionId = saved.actionItems[0]!.id;
      const reopened = yield* h.open();
      expect(yield* reopened.get({ threadId })).toEqual(saved);
      const next = yield* reopened.patch({
        threadId,
        expectedRevision: 1,
        changes: [{ kind: "action", id: actionId, status: "deferred" }],
      });
      expect(next.summaryNotes).toBe(saved.summaryNotes);
      expect(next.actionItems[0]?.status).toBe("deferred");
      const stale = yield* Effect.result(
        reopened.patch({
          threadId,
          expectedRevision: 1,
          changes: [{ kind: "action", id: actionId, status: "done" }],
        }),
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
        Effect.result(
          h.service.patch({ threadId, expectedRevision: 0, changes: [], summaryNotes }),
        ),
      { concurrency: "unbounded" },
    );
    expect(results.filter(Result.isSuccess)).toHaveLength(1);
    expect(results.filter(Result.isFailure).map((result) => result.failure.code)).toEqual([
      "conflict",
    ]);
    expect((yield* h.service.get({ threadId })).revision).toBe(1);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("rejects malformed saved documents instead of resetting them", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const saved = yield* h.service.patch({
      threadId,
      expectedRevision: 0,
      changes: [{ kind: "action", title: item.title }],
    });
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
          h.service.patch({ threadId, expectedRevision: 0, changes: [], summaryNotes: "No" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "thread", cause: broken } });
      h.setThreadFailure(null);
      yield* h.fs.writeFileString(h.directory, "blocks directory creation");
      expect(
        yield* Effect.result(
          h.service.patch({ threadId, expectedRevision: 0, changes: [], summaryNotes: "No" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { code: "storage", cause: expect.anything() } });
      h.setDeleted();
      expect(yield* Effect.result(h.service.get({ threadId }))).toMatchObject({
        _tag: "Failure",
        failure: { code: "not_found" },
      });
      expect(
        yield* Effect.result(
          h.service.patch({ threadId, expectedRevision: 0, changes: [], summaryNotes: "No" }),
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
      for (const changes of [
        [{ kind: "group", id: groupId, parentId: groupId }],
        [{ kind: "group", title: "Orphan", parentId: "missing" }],
      ] as const) {
        expect(
          yield* Effect.result(
            h.service.patch({ threadId, expectedRevision: current.revision, changes }),
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
        agentWork: 0,
        openAgentWork: 0,
        pendingQa: 0,
        records: 0,
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
      expect(detail.questions?.[0]).toMatchObject({
        status: "answered",
        submitted: { text: expect.stringContaining("Answer: Immediate") },
      });
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
        changes: [],
        summaryNotes: "Current state",
      });
      expect(yield* (yield* h.open()).get({ threadId })).toEqual(saved);
      expect(yield* h.fs.readFileString(reviewPath)).toBe(legacyReview);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("keeps the child preamble across reopen and reads saves without one as empty", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    yield* h.service.mutate({
      threadId,
      expectedRevision: 0,
      changes: [],
      childPreamble: "Use the shared env.",
    });
    const edited = yield* (yield* h.open()).patch({
      threadId,
      expectedRevision: 1,
      changes: [],
      childPreamble: "Use the shared env. Report friction.",
    });
    expect((yield* (yield* h.open()).get({ threadId })).childPreamble).toBe(
      "Use the shared env. Report friction.",
    );
    const { childPreamble: _, ...older } = edited;
    yield* h.fs.writeFileString(h.file, JSON.stringify({ formatVersion: 2, workspace: older }));
    expect((yield* (yield* h.open()).get({ threadId })).childPreamble).toBe("");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("merges a user answer and an agent edit that both started from the same revision", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const created = yield* h.service.mutate({
      threadId,
      expectedRevision: 0,
      changes: [
        { kind: "question", title: "Which rollout?" },
        { kind: "action", title: "Confirm owner" },
      ],
    });
    const question = created.items.find((entry) => entry.kind === "question")!;
    const action = created.items.find((entry) => entry.kind === "action")!;
    const seen = created.revision;
    const agent = yield* h.service.mutate({
      threadId,
      expectedRevision: seen,
      changes: [{ kind: "action", id: action.id, title: "Confirm the owner" }],
      summaryNotes: "Agent caught up",
    });
    const user = yield* h.service.saveDraft({
      threadId,
      expectedRevision: seen,
      userDraft: {
        questionAnswers: { [question.id]: { selectedOptionIds: [], notes: "Slow" } },
        actionNotes: {},
      },
    });
    expect(user.revision).toBe(agent.revision + 1);
    const status = yield* h.service.patch({
      threadId,
      expectedRevision: seen,
      changes: [{ kind: "action", id: action.id, status: "done" }],
    });
    const reopened = yield* (yield* h.open()).get({ threadId });
    expect(reopened).toEqual(status);
    expect(reopened.summaryNotes).toBe("Agent caught up");
    expect(reopened.actionItems).toMatchObject([{ title: "Confirm the owner", status: "done" }]);
    expect(reopened.userDraft.questionAnswers[question.id]?.notes).toBe("Slow");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("conflicts only on the same field or a removed item and never loses either write", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const created = yield* h.service.mutate({
      threadId,
      expectedRevision: 0,
      changes: [
        { kind: "question", title: "Q one" },
        { kind: "action", title: "First" },
        { kind: "action", title: "Second" },
      ],
    });
    const [question, first, second] = created.items;
    const seen = created.revision;
    yield* h.service.mutate({
      threadId,
      expectedRevision: seen,
      changes: [
        { kind: "question", id: question!.ref, title: "Agent title" },
        { kind: "action", id: second!.id, remove: true },
      ],
    });
    yield* h.service.saveDraft({
      threadId,
      expectedRevision: seen,
      userDraft: { questionAnswers: {}, actionNotes: { [first!.id]: "Device A" } },
    });
    const before = yield* h.service.get({ threadId });
    for (const attempt of [
      h.service.patch({
        threadId,
        expectedRevision: seen,
        changes: [{ kind: "question", id: question!.id, title: "User title" }],
      }),
      h.service.patch({
        threadId,
        expectedRevision: seen,
        changes: [{ kind: "action", id: second!.id, status: "done" }],
      }),
      h.service.saveDraft({
        threadId,
        expectedRevision: seen,
        userDraft: { questionAnswers: {}, actionNotes: { [first!.id]: "Device B" } },
      }),
    ])
      expect(yield* Effect.result(attempt)).toMatchObject({
        _tag: "Failure",
        failure: { code: "conflict", currentRevision: before.revision },
      });
    expect(yield* h.service.get({ threadId })).toEqual(before);
    const merged = yield* h.service.patch({
      threadId,
      expectedRevision: seen,
      changes: [
        { kind: "action", id: second!.id, remove: true },
        { kind: "action", id: first!.id, status: "deferred" },
        { kind: "action", title: "Third" },
      ],
    });
    expect(merged.questions[0]?.title).toBe("Agent title");
    expect(merged.actionItems.map((entry) => [entry.title, entry.status])).toEqual([
      ["First", "deferred"],
      ["Third", "open"],
    ]);
    expect(merged.userDraft.actionNotes[first!.id]).toBe("Device A");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "keeps agent work apart from user actions with server-set provenance and reads older saves",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.fs.makeDirectory(h.directory, { recursive: true });
      const older = {
        ...Workspaces.emptyWorkspace(threadId),
        revision: 26,
        actionItems: [{ ...item, ref: "A-OLD", groupId: "ungrouped" }],
        userDraft: { questionAnswers: {}, actionNotes: { decision: "Keep this" } },
      };
      const {
        agentWork: _w,
        decisions: _d,
        contextItems: _c,
        childPreamble: _p,
        ...legacy
      } = older;
      yield* h.fs.writeFileString(h.file, JSON.stringify({ formatVersion: 2, workspace: legacy }));
      expect(yield* h.service.get({ threadId })).toEqual(older);
      yield* h.service.mutate({
        threadId,
        expectedRevision: 26,
        changes: [
          {
            kind: "work",
            title: "Add merge",
            status: "active",
            remaining: "web test",
            source: "chat",
          },
          { kind: "decision", title: "Stamp per field", rationale: "Smallest merge" },
          { kind: "decision", title: "No separate DB", decidedBy: "user", source: "chat" },
        ],
      });
      const user = yield* h.service.patch({
        threadId,
        expectedRevision: 26,
        changes: [{ kind: "context", category: "preference", title: "Dense rows" }],
      });
      const work = user.agentWork[0]!;
      expect(user.actionItems).toEqual(older.actionItems);
      expect(user.userDraft).toEqual(older.userDraft);
      expect(
        user.decisions.map((entry) => [entry.decidedBy, entry.status, entry.recordedBy]),
      ).toEqual([
        ["agent", "proposed", "agent"],
        ["user", "accepted", "agent"],
      ]);
      expect(user.contextItems[0]).toMatchObject({ category: "preference", recordedBy: "user" });
      const done = yield* h.service.mutate({
        threadId,
        expectedRevision: user.revision,
        changes: [{ kind: "work", id: work.ref, status: "done", details: "Merged" }],
      });
      const record = yield* h.service.query({ threadId, section: "record" });
      expect(record.agentWork).toMatchObject([
        { status: "done", userQa: "pending", completedAt: expect.any(String) },
      ]);
      expect(record.actionItems).toEqual(older.actionItems);
      expect(record.decisions).toHaveLength(2);
      expect(done.revision).toBe(user.revision + 1);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("marks a question answered only once the user sends its feedback from the composer", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const created = yield* h.service.mutate({
      threadId,
      expectedRevision: 0,
      changes: [
        {
          kind: "question",
          title: "Which rollout?",
          options: [{ id: "slow", label: "Gradual", description: "" }],
        },
        { kind: "question", title: "Recovery?" },
      ],
    });
    const [question, other] = created.items;
    const saved = yield* h.service.saveDraft({
      threadId,
      expectedRevision: created.revision,
      userDraft: {
        questionAnswers: {
          [question!.id]: { selectedOptionIds: ["slow"], notes: "Watch the error rate" },
          [other!.id]: { selectedOptionIds: [], notes: "Private, unsent" },
        },
        actionNotes: {},
      },
    });
    expect((yield* h.service.query({ threadId })).items.map((item) => item.status)).toEqual([
      "open",
      "open",
    ]);
    const composed = formatWorkspaceFeedback(
      { environmentId: EnvironmentId.make("test-environment"), threadId },
      saved,
      [question!.id],
    );
    yield* h.sendFromComposer(`Thoughts below.\n\n${composed.markdown}\n\nThanks`, {
      version: 1,
      records: composed.records,
    });
    const index = yield* h.service.query({ threadId });
    expect(index.items.map((item) => [item.id, item.status])).toEqual([
      [question!.id, "answered"],
      [other!.id, "open"],
    ]);
    const open = yield* h.service.query({ threadId, section: "questions", status: ["open"] });
    expect(open.questions?.map((item) => item.id)).toEqual([other!.id]);
    const detail = yield* h.service.query({
      threadId,
      section: "questions",
      itemIds: [question!.ref],
    });
    expect(detail.questions?.[0]?.submitted?.text).toContain("Answer: Gradual");
    expect(detail.questions?.[0]?.submitted?.text).toContain("Notes: Watch the error rate");
    expect(detail.questions?.[0]?.submitted?.text).not.toContain("Thoughts below");
    expect(JSON.stringify(yield* h.service.query({ threadId, section: "all" }))).not.toContain(
      "Private, unsent",
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("returns only the items an update changed unless the full index is requested", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const seeded = yield* h.service.mutate({
      threadId,
      expectedRevision: 0,
      changes: [
        { kind: "group", title: "Unrelated topic" },
        { kind: "design", title: "Unrelated design", markdown: "Long body" },
        { kind: "action", title: "Unrelated action" },
        { kind: "work", title: "Ship merge" },
      ],
    });
    const work = seeded.items.find((item) => item.kind === "work")!;
    const update = yield* h.service.mutate({
      threadId,
      expectedRevision: seeded.revision,
      changes: [{ kind: "work", id: work.ref, status: "landed", userQa: "pending" }],
    });
    expect(update.revision).toBe(seeded.revision + 1);
    expect(update.groups).toEqual([]);
    expect(update.items).toEqual([{ ...work, status: "landed" }]);
    const removed = yield* h.service.mutate({
      threadId,
      expectedRevision: update.revision,
      changes: [
        {
          kind: "action",
          id: seeded.items.find((item) => item.kind === "action")!.id,
          remove: true,
        },
      ],
    });
    expect(removed.items).toEqual([]);
    expect(removed.removedIds).toHaveLength(1);
    const full = yield* h.service.mutate({
      threadId,
      expectedRevision: removed.revision,
      changes: [],
      fullIndex: true,
    });
    expect(full.items.map((item) => item.kind)).toEqual(["design", "work"]);
    expect(full.groups.map((group) => group.title)).toContain("Unrelated topic");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "records QA evidence with server provenance so self-report never reads as independent",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const implementer = ThreadId.make("implementer-thread");
      const verifier = ThreadId.make("verifier-thread");
      const created = yield* h.service.mutate(
        {
          threadId,
          expectedRevision: 0,
          changes: [
            {
              kind: "work",
              title: "Field merge",
              status: "landed",
              changed: "Workspace writes merge per field",
              qaSteps: "Answer a question while the agent edits",
              checks: "vp test ThreadWorkspace.test.ts",
              userQa: "pending",
            },
          ],
        },
        implementer,
      );
      const work = created.items[0]!;
      const evidence = (writer: ThreadId, method: "executed" | "source-review") =>
        h.service.mutate(
          {
            threadId,
            expectedRevision: created.revision,
            changes: [
              {
                kind: "verification",
                workId: work.ref,
                verifier: "Claimed independent reviewer",
                method,
                details: "vp test run",
                testedRevision: "abc123",
                result: "pass",
                gaps: "No mobile pass",
              },
            ],
          },
          writer,
        );
      yield* evidence(implementer, "executed");
      yield* evidence(verifier, "source-review");
      yield* evidence(verifier, "executed");
      const qa = yield* h.service.query({ threadId, section: "work", userQa: ["pending"] });
      const item = qa.agentWork![0]!;
      expect(item).toMatchObject({
        status: "landed",
        userQa: "pending",
        recordedByThreadId: implementer,
      });
      expect(qa.verifications?.map((entry) => isIndependentVerification(item, entry))).toEqual([
        false,
        false,
        true,
      ]);
      expect(isIndependentVerification({ recordedByThreadId: null }, qa.verifications![2]!)).toBe(
        false,
      );
      expect(qa.verifications?.[0]).toMatchObject({
        testedRevision: "abc123",
        at: expect.any(String),
      });
      const aggregate = yield* h.service.listWork({ userQa: ["pending"] });
      expect(aggregate).toHaveLength(1);
      expect(aggregate[0]?.verifications).toEqual(qa.verifications);
      expect(aggregate[0]?.item.recordedByThreadId).toBe(implementer);
      const passed = yield* h.service.patch({
        threadId,
        expectedRevision: created.revision,
        changes: [{ kind: "work", id: work.id, userQa: "passed" }],
      });
      expect(passed.agentWork[0]).toMatchObject({ status: "landed", userQa: "passed" });
      expect(yield* h.service.counts({ threadId })).toMatchObject({
        openAgentWork: 0,
        pendingQa: 0,
      });
      expect(
        (yield* h.service.query({ threadId, section: "work", userQa: ["pending"] })).agentWork,
      ).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect(
  "lists persisted agent work across archived and settled threads without private fields",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      expect(yield* h.service.listWork({})).toEqual([]);
      const secondThreadId = ThreadId.make("second-work-thread");
      for (const id of [threadId, secondThreadId]) {
        yield* h.service.patch({
          threadId: id,
          expectedRevision: 0,
          changes: [
            {
              kind: "work",
              title: `Work ${id}`,
              status: "done",
              changed: "Shipped",
              qaSteps: "Try it",
            },
          ],
        });
        yield* h.service.saveDraft({
          threadId: id,
          expectedRevision: 1,
          userDraft: { questionAnswers: {}, actionNotes: { secret: "private draft" } },
        });
      }
      const rows = yield* h.service.listWork({});
      expect(rows.map((row) => row.threadId).toSorted()).toEqual(
        [threadId, secondThreadId].toSorted(),
      );
      expect(rows.every((row) => row.item.userQa === "pending")).toBe(true);
      expect(rows.every((row) => row.threadTitle === "Thread")).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("private");
      expect(yield* h.service.listWork({ userQa: ["passed"] })).toEqual([]);
      const work = rows.find((row) => row.threadId === threadId)!;
      yield* h.service.patch({
        threadId,
        expectedRevision: work.revision,
        changes: [{ kind: "work", id: work.item.id, userQa: "issues", userQaNote: "Still broken" }],
      });
      const issues = yield* h.service.listWork({ userQa: ["issues"] });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.item.userQaNote).toBe("Still broken");
      h.setDeleted();
      expect(yield* h.service.listWork({})).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
);
