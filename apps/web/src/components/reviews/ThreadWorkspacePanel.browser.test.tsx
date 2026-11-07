import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ThreadId,
  type ThreadActionItem,
  type ThreadWorkspace,
  type ThreadWorkspaceMutateInput,
  type ThreadWorkspaceSaveDraftInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../../rightPanelStore";
const state = vi.hoisted(() => ({
  query: vi.fn(),
  counts: vi.fn(),
  marks: vi.fn(),
  command: vi.fn(),
}));
vi.mock("../../state/threadWorkspace", () => ({
  threadWorkspaceGet: state.query,
  threadWorkspaceCounts: state.counts,
  threadWorkspacePatch: "patch",
  threadWorkspaceSaveDraft: "save",
  threadWorkspaceSubmit: "submit",
}));
vi.mock("../../state/threadMarks", () => ({ threadMarksGet: state.marks }));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (name: string) => (input: unknown) => state.command(name, input),
}));
vi.mock("./useReviewSupport", () => ({ useReviewSupport: () => true }));
vi.mock("../insights/ThreadInsightsPanel", () => ({ ThreadInsightsPanel: () => null }));
vi.mock("../notes/NotesPanel", () => ({ NotesPanel: () => null }));
vi.mock("./WorkspaceMarksPanel", () => ({ WorkspaceMarksPanel: () => null }));
vi.mock("./WorkspaceThreadsPanel", () => ({ WorkspaceThreadsPanel: () => null }));
vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <div>{text}</div> }));
import { ThreadWorkspacePanel } from "./ThreadWorkspacePanel";
import { useComposerDraftStore } from "../../composerDraftStore";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useWorkspaceViewState } from "./workspaceViewState";
const ref = {
  environmentId: EnvironmentId.make("scratchboard-browser"),
  threadId: ThreadId.make("scratchboard"),
};
function setup(multiSelect = false, retired = false) {
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
  let workspace: ThreadWorkspace = {
    threadId: ref.threadId,
    revision: 1,
    updatedAt: null,
    groups: [
      { id: "cli", parentId: null, title: "CLI design" },
      { id: "profile", parentId: "cli", title: "Profiles" },
      { id: "ungrouped", parentId: null, title: "Ungrouped" },
    ],
    questions: [
      {
        id: "q1",
        ref: "Q-7K2",
        groupId: "profile",
        title: "What should a profile control?",
        details: "Choose the contract.",
        options: [
          { id: "storage", label: "Storage", description: "Storage only" },
          { id: "execution", label: "Execution", description: "Execution too" },
        ],
        recommendedOptionIds: ["storage"],
        recommendation: "Storage preserves the existing contract.",
        multiSelect,
      },
    ],
    actionItems: [
      {
        id: "a1",
        ref: "A-8M3",
        groupId: "profile",
        title: "Share a config",
        details: "An example helps.",
        status: "open",
      },
    ],
    designDocuments: [
      {
        id: "d1",
        ref: "D-4A2",
        groupId: "profile",
        title: "Profile boundaries",
        markdown: "The host owns execution.",
        html: null,
      },
    ],
    agentWork: [
      {
        id: "w1",
        ref: "W-1A2",
        title: "Field-level merge",
        status: "landed",
        remaining: "",
        source: "user ask",
        details: "",
        changed: "Answers and agent edits merge per field",
        qaSteps: "Answer while the agent edits",
        checks: "server merge tests",
        userQa: "pending",
        userQaNote: "",
        completedAt: "2026-11-07T10:00:00.000Z",
        recordedByThreadId: ThreadId.make("implementer"),
      },
    ],
    verifications: [
      {
        id: "v1",
        ref: "V-1",
        workId: "w1",
        verifier: "root",
        method: "executed",
        details: "vp test run",
        testedRevision: "abc123",
        result: "pass",
        gaps: "no mobile",
        evidence: "",
        at: "2026-11-07T11:00:00.000Z",
        recordedBy: "agent",
        recordedByThreadId: ThreadId.make("root"),
      },
    ],
    decisions: [],
    contextItems: [],
    childPreamble: "",
    designNotes: "",
    summaryNotes: "Reviewing the CLI contract.",
    relatedThreads: [],
    markAnnotations: [],
    userDraft: {
      questionAnswers: retired
        ? { q1: { selectedOptionIds: ["retired-choice"], notes: "Keep my notes" } }
        : {},
      actionNotes: {},
    },
    submissions: [],
  };
  const atom = Atom.make(AsyncResult.success(workspace)).pipe(Atom.keepAlive);
  const queryAtom = Atom.make((get) => get(atom)).pipe(Atom.keepAlive);
  state.query.mockReset().mockReturnValue(queryAtom);
  state.counts.mockReset().mockReturnValue(
    Atom.make((get) => {
      const current = AsyncResult.getOrElse(get(atom), () => workspace);
      return AsyncResult.success({
        questions: current.questions.length,
        actions: current.actionItems.length,
        designs: current.designDocuments.length,
        relatedThreads: current.relatedThreads.length,
      });
    }).pipe(Atom.keepAlive),
  );
  state.marks.mockReset().mockReturnValue(Atom.make(AsyncResult.success([])).pipe(Atom.keepAlive));
  // Mirrors the server's per-entry merge: only an entry changed after the writer's revision conflicts.
  const changedAt: Record<string, number> = {};
  state.command
    .mockReset()
    .mockImplementation(
      async (
        name: string,
        { input }: { input: ThreadWorkspaceSaveDraftInput & ThreadWorkspaceMutateInput },
      ) => {
        const conflict = () =>
          AsyncResult.failure(Cause.fail(new Error("Workspace changed on another client.")));
        const revision = workspace.revision + 1;
        if (name === "save") {
          for (const id of Object.keys(input.userDraft.questionAnswers))
            if ((changedAt[`answer:${id}`] ?? 0) > input.expectedRevision) return conflict();
          for (const id of Object.keys(input.userDraft.questionAnswers))
            changedAt[`answer:${id}`] = revision;
          workspace = {
            ...workspace,
            revision,
            userDraft: {
              questionAnswers: {
                ...workspace.userDraft.questionAnswers,
                ...input.userDraft.questionAnswers,
              },
              actionNotes: { ...workspace.userDraft.actionNotes, ...input.userDraft.actionNotes },
            },
          };
        } else if (name === "patch") {
          for (const change of input.changes) {
            const key = `${change.kind}:${change.id}`;
            if ((changedAt[key] ?? 0) > input.expectedRevision) return conflict();
            changedAt[key] = revision;
            workspace = {
              ...workspace,
              revision,
              actionItems: workspace.actionItems.map((item) =>
                item.id === change.id && change.status !== undefined
                  ? { ...item, status: change.status as ThreadActionItem["status"] }
                  : item,
              ),
              agentWork: workspace.agentWork.map((item) =>
                item.id === change.id && change.userQa !== undefined
                  ? { ...item, userQa: change.userQa }
                  : item,
              ),
            };
          }
        }
        appAtomRegistry.set(atom, AsyncResult.success(workspace));
        return { _tag: "Success", value: workspace };
      },
    );
  useRightPanelStore.setState({
    byThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
  useRightPanelStore.getState().openReviews(ref);
  useWorkspaceViewState.setState({
    closed: {},
    outlineHidden: false,
    focusedItem: null,
  });
  return {
    getWorkspace: () => workspace,
    addLateQuestion: () => {
      const original = workspace.questions[0]!;
      workspace = {
        ...workspace,
        revision: workspace.revision + 1,
        questions: [
          ...workspace.questions,
          {
            ...original,
            id: "late-question",
            ref: "Q-LATE",
            title: "Late question",
            details: "Loaded after following the source reference.",
          },
        ],
      };
      appAtomRegistry.set(atom, AsyncResult.success(workspace));
    },
    externalEdit: () => {
      changedAt["answer:q1"] = workspace.revision + 1;
      workspace = {
        ...workspace,
        revision: workspace.revision + 1,
        userDraft: {
          ...workspace.userDraft,
          questionAnswers: { q1: { selectedOptionIds: [], notes: "Another client answer" } },
        },
      };
      appAtomRegistry.set(atom, AsyncResult.success(workspace));
    },
  };
}
function Panel() {
  const surface = useRightPanelStore((store) =>
    selectActiveRightPanelSurface(store.byThreadKey, ref),
  );
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <div
        data-testid="workspace-fixture"
        className="flex h-[800px] w-[700px] bg-background text-foreground"
      >
        <ThreadWorkspacePanel
          threadRef={ref}
          section={
            surface?.kind === "reviews" ? (surface.workspaceSection ?? "questions") : "questions"
          }
          reviewId={null}
          visible
          startedThread
        />
      </div>
    </RegistryContext.Provider>
  );
}
async function wideViewport() {
  const original = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1100, 900);
  return { [Symbol.asyncDispose]: () => page.viewport(original.width, original.height) };
}
it("shares expanded groups across tabs and sends explicit answers without accepting recommendations", async () => {
  await using _viewport = await wideViewport();
  const fixture = setup();
  await using _screen = await render(<Panel />);
  await expect.element(page.getByRole("tab", { name: "Questions 1", exact: true })).toBeVisible();
  await expect.element(page.getByRole("tab", { name: "Marks 0", exact: true })).toBeVisible();
  await expect.element(page.getByRole("tab", { name: "Threads 0", exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("tab", { name: "Loads", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole("tab", { name: "Tokens", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Add ready responses to chat" }))
    .toBeDisabled();
  await page.getByText("What should a profile control?", { exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: /Storage.*Recommended/ }))
    .toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: /Storage.*Recommended/ }).click();
  await page.getByRole("button", { name: /^Execution/ }).click();
  useComposerDraftStore.getState().setPrompt(ref, "My existing draft");
  await page.getByRole("button", { name: "Add to chat", exact: true }).click();
  await vi.waitFor(() => {
    const draft = useComposerDraftStore.getState().draftsByThreadKey[scopedThreadKey(ref)];
    expect(draft?.prompt).toContain("My existing draft");
    expect(draft?.prompt).toContain("Answer: Execution");
    expect(draft?.threadContexts).toMatchObject([{ workspaceItemId: "q1" }]);
  });
  expect(state.command.mock.calls.some(([name]) => name === "submit")).toBe(false);
  expect(fixture.getWorkspace().userDraft.questionAnswers.q1?.selectedOptionIds).toEqual([
    "execution",
  ]);
  await page.getByRole("button", { name: "CLI design", exact: true }).last().click();
  await page.getByRole("tab", { name: /^Action items 1$/ }).click();
  await expect.element(page.getByText("Share a config", { exact: true })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "CLI design", exact: true }).first().click();
  await page.getByText("Share a config", { exact: true }).click();
  await page.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add ready responses to chat" }).click();
  await vi.waitFor(() => {
    const prompt = useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "";
    expect(prompt.match(/Answer: Execution/g)).toHaveLength(1);
    expect(prompt).toContain("Status: done");
  });
  await page.getByRole("tab", { name: /^Design 1$/ }).click();
  await expect.element(page.getByText("The host owns execution.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Unified", exact: true }).click();
  await page.getByText("What should a profile control?", { exact: true }).click();
  await page.getByRole("button", { name: "Hide headings" }).click();
  await expect
    .element(page.getByRole("navigation", { name: "Workspace headings" }))
    .not.toBeInTheDocument();
  await page.getByRole("tab", { name: /^Questions 1$/ }).click();
  useWorkspaceViewState
    .getState()
    .focusItem(`${ref.environmentId}:${ref.threadId}`, "late-question");
  await expect.element(page.getByText("Late question", { exact: true })).not.toBeInTheDocument();
  fixture.addLateQuestion();
  await expect
    .element(page.getByRole("textbox", { name: "Answer to Late question" }))
    .toBeVisible();
  await vi.waitFor(() => expect(useWorkspaceViewState.getState().focusedItem).toBeNull());
});

it("keeps a conflicting local answer while unrelated edits still save", async () => {
  await using _viewport = await wideViewport();
  const fixture = setup(true);
  await using _screen = await render(<Panel />);
  await page.getByText("What should a profile control?", { exact: true }).click();
  await page.getByRole("button", { name: /Storage.*Recommended/ }).click();
  await page.getByRole("button", { name: /^Execution/ }).click();
  await expect
    .element(page.getByRole("button", { name: /Storage.*Recommended/ }))
    .toHaveAttribute("aria-pressed", "true");
  await expect
    .element(page.getByRole("button", { name: /^Execution/ }))
    .toHaveAttribute("aria-pressed", "true");
  fixture.externalEdit();
  await page.getByRole("button", { name: "Add to chat", exact: true }).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Workspace changed on another client.",
    ),
  );
  expect(state.command.mock.calls.some(([name]) => name === "submit")).toBe(false);
  await expect
    .element(page.getByRole("button", { name: /Storage.*Recommended/ }))
    .toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: /^Action items 1$/ }).click();
  await page.getByText("Share a config", { exact: true }).click();
  await page.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
  expect(fixture.getWorkspace().actionItems[0]?.status).toBe("done");
  await page.getByRole("tab", { name: /^Questions 1$/ }).click();
  await page.getByText("What should a profile control?", { exact: true }).click();
  await page.getByRole("button", { name: "Reload saved answers" }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Answer to What should a profile control?" }))
    .toHaveValue("Another client answer");
});

it("retains removed choices and private notes until the user explicitly removes an unavailable selection", async () => {
  await using _viewport = await wideViewport();
  const fixture = setup(true, true);
  await using _screen = await render(<Panel />);
  await page.getByText("What should a profile control?", { exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Add to chat", exact: true }))
    .toBeDisabled();
  await page.getByRole("button", { name: "Remove unavailable choice retired-choice" }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Answer to What should a profile control?" }))
    .toHaveValue("Keep my notes");
  await page.getByRole("button", { name: "Add to chat", exact: true }).click();
  await vi.waitFor(() =>
    expect(
      useComposerDraftStore.getState().draftsByThreadKey[scopedThreadKey(ref)]?.prompt,
    ).toContain("Keep my notes"),
  );
  expect(fixture.getWorkspace().userDraft.questionAnswers.q1).toEqual({
    selectedOptionIds: [],
    notes: "Keep my notes",
  });
});

it("adds a completed action without notes to the composer without sending it", async () => {
  await using _viewport = await wideViewport();
  setup();
  await using _screen = await render(<Panel />);
  await page.getByRole("tab", { name: /^Action items 1$/ }).click();
  await page.getByText("Share a config", { exact: true }).click();
  await page.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Add ready responses to chat" }))
    .toBeEnabled();
  await page.getByRole("button", { name: "Add ready responses to chat" }).click();
  await vi.waitFor(() => {
    const draft = useComposerDraftStore.getState().draftsByThreadKey[scopedThreadKey(ref)];
    expect(draft?.prompt).toContain("Action: Share a config\nStatus: done");
    expect(draft?.threadContexts).toMatchObject([{ workspaceItemId: "a1" }]);
  });
  expect(state.command.mock.calls.some(([name]) => name === "submit")).toBe(false);
});

it("lists agent work apart from the user's actions and records human QA without changing agent status", async () => {
  await using _viewport = await wideViewport();
  const fixture = setup();
  await using _screen = await render(<Panel />);
  await page.getByRole("tab", { name: "Agent work", exact: true }).click();
  await expect.element(page.getByText("Field-level merge", { exact: true })).toBeVisible();
  await expect.element(page.getByText(/pass · independent run · root · at abc123/)).toBeVisible();
  await expect.element(page.getByText("Share a config", { exact: true })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Pass", exact: true }).click();
  await expect.element(page.getByText("QA passed", { exact: true })).toBeVisible();
  expect(fixture.getWorkspace().agentWork[0]).toMatchObject({ status: "landed", userQa: "passed" });
  await page.getByRole("button", { name: "Back to pending", exact: true }).click();
  await expect.element(page.getByText("QA pending", { exact: true })).toBeVisible();
});
