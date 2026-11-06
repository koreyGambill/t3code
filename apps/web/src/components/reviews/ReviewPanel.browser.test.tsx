import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  MessageId,
  ReviewId,
  ThreadId,
  type ReviewArtifact,
  type ReviewDraft,
  type ReviewSummary,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { randomUUID } from "../../lib/utils";
import type { ReviewTarget } from "../../state/reviews";

const state = vi.hoisted(() => ({
  artifact: null as unknown,
  list: null as unknown,
  server: null as unknown,
  supported: true,
  queryList: vi.fn(),
  queryGet: vi.fn(),
  save: vi.fn<
    (target: ReviewTarget, revision: number, draft: ReviewDraft) => Promise<ReviewArtifact>
  >(),
  submit: vi.fn<(target: ReviewTarget, revision: number) => Promise<ReviewArtifact>>(),
}));
vi.mock("../../state/reviews", () => ({
  reviewArtifactsList: state.queryList,
  reviewArtifactGet: state.queryGet,
  reviewArtifactCreate: "create",
  persistReviewDraft: state.save,
  submitReviewDraft: state.submit,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("./useReviewSupport", () => ({ useReviewSupport: () => state.supported }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

import { ReviewPanel } from "./ReviewPanel";

const threadRef = {
  environmentId: EnvironmentId.make("review-browser"),
  threadId: ThreadId.make("thread-review"),
};
function server() {
  return state.server as ReviewArtifact;
}
function setup(remindAt: string | null = null) {
  const artifact: ReviewArtifact = {
    id: ReviewId.make(randomUUID()),
    threadId: threadRef.threadId,
    revision: 1,
    content: {
      title: "Plan the workspace update",
      summary: "Review the proposed approach before work begins.",
      sections: [
        {
          id: "approach",
          title: "Implementation approach",
          markdown: "Keep public interfaces stable and make the change easy to review.",
          questions: [
            {
              id: "approach-question",
              prompt: "Which approach should we take?",
              context: "The existing interface already supports the required behavior.",
              recommendation: "Build on the existing interface because it keeps the change small.",
              recommendedOptionId: "existing",
              multiSelect: false,
              options: [
                {
                  id: "existing",
                  label: "Use the existing interface",
                  description: "Keep existing integrations working.",
                },
                {
                  id: "replace",
                  label: "Design a replacement",
                  description: "Allow a larger change to the interface.",
                },
              ],
            },
          ],
        },
        {
          id: "validation",
          title: "Validation",
          markdown: "Check the user workflow and record what was verified.",
          questions: [],
        },
      ],
    },
    draft: { answers: {}, annotations: [], notes: "", remindAt },
    lastSubmission: null,
    createdAt: "2026-11-05T12:00:00.000Z",
    updatedAt: "2026-11-05T12:00:00.000Z",
  };
  state.server = artifact;
  state.artifact = Atom.make(AsyncResult.success(artifact)).pipe(Atom.keepAlive);
  state.list = Atom.make(AsyncResult.success([])).pipe(Atom.keepAlive);
  state.queryList.mockReset().mockReturnValue(state.list);
  state.queryGet.mockReset().mockReturnValue(state.artifact);
  state.supported = true;
  state.save.mockReset().mockImplementation(async (_, revision, draft) => {
    expect(revision).toBe(server().revision);
    state.server = { ...server(), draft, revision: revision + 1 };
    return server();
  });
  state.submit.mockReset().mockImplementation(async (_, revision) => {
    expect(revision).toBe(server().revision);
    state.server = {
      ...server(),
      lastSubmission: {
        revision,
        messageId: MessageId.make("review-response"),
        submittedAt: artifact.createdAt,
        markdown: "Review response",
      },
    };
    return server();
  });
  return artifact;
}
const panel = (
  artifact: ReviewArtifact,
  width = 420,
  selectedId: string | null = artifact.id,
  startedThread = true,
) => (
  <RegistryContext.Provider value={appAtomRegistry}>
    <div style={{ width, height: 760 }} className="flex bg-background text-foreground">
      <ReviewPanel
        threadRef={threadRef}
        reviewId={selectedId}
        visible
        startedThread={startedThread}
      />
    </div>
  </RegistryContext.Provider>
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

it("keeps recommendations unselected and saves answers across a panel switch", async () => {
  const artifact = setup();
  state.save.mockRejectedValueOnce(new Error("Review storage is unavailable"));
  await using screen = await render(panel(artifact));
  const option = page.getByRole("radio", { name: /Use the existing interface/ });
  await expect.element(option).not.toBeChecked();
  await expect
    .element(page.getByRole("button", { name: "Send review to chat", exact: true }))
    .toBeDisabled();
  await option.click();
  await page.getByRole("textbox", { name: /^Notes:/ }).fill("Preserve the public contract.");
  await screen.rerender(<div />);
  await vi.waitFor(() => expect(state.save).toHaveBeenCalled());
  await screen.rerender(panel(artifact));
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect.element(option).toBeChecked();
  await expect
    .element(page.getByRole("textbox", { name: /^Notes:/ }))
    .toHaveValue("Preserve the public contract.");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await vi.waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  expect(server().draft.answers["approach-question"]?.notes).toBe("Preserve the public contract.");
  expect(state.submit).not.toHaveBeenCalled();
});

it("saves and cancels a review reminder without sending answers or snoozing the thread", async () => {
  const artifact = setup();
  await using _screen = await render(panel(artifact));
  await page.getByRole("button", { name: "Remind me later", exact: true }).click();
  await page.getByRole("menuitem").first().click();
  await vi.waitFor(() => expect(server().draft.remindAt).not.toBeNull());
  await page.getByRole("button", { name: "Change reminder", exact: true }).click();
  await page.getByRole("menuitem", { name: "Cancel reminder", exact: true }).click();
  await vi.waitFor(() => expect(server().draft.remindAt).toBeNull());
  expect(state.submit).not.toHaveBeenCalled();
});

it("waits for the latest save before sending and preserves answers after a send failure", async () => {
  const artifact = setup();
  const saving = deferred<ReviewArtifact>();
  state.save.mockImplementationOnce(async (_, revision, draft) => {
    const result = await saving.promise;
    state.server = { ...result, draft, revision: revision + 1 };
    return server();
  });
  state.submit.mockRejectedValueOnce(new Error("Could not queue review"));
  await using _screen = await render(panel(artifact));
  await page.getByRole("textbox", { name: /^Notes:/ }).fill("Keep the current contract.");
  await expect
    .element(page.getByRole("button", { name: "Send review to chat", exact: true }))
    .toBeEnabled();
  await page.getByRole("button", { name: "Send review to chat", exact: true }).click();
  await vi.waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.submit).not.toHaveBeenCalled();
  await act(async () => {
    saving.resolve(artifact);
    await saving.promise;
  });
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: /^Notes:/ }))
    .toHaveValue("Keep the current contract.");
  await page.getByRole("button", { name: "Send review to chat", exact: true }).click();
  await vi.waitFor(() => expect(state.submit).toHaveBeenCalledTimes(2));
  await expect
    .element(page.getByRole("button", { name: "Sent to chat", exact: true }))
    .toBeDisabled();
  expect(server().draft.answers["approach-question"]?.notes).toBe("Keep the current contract.");
});

it("attaches a selected quotation to the right question and keeps it private until Send", async () => {
  const artifact = setup();
  await using _screen = await render(panel(artifact));
  const prompt = page.getByText("Which approach should we take?", { exact: true });
  await expect.element(prompt).toBeVisible();
  await act(() => {
    const node = prompt.element();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Add note on selection" }).click();
  await page
    .getByRole("textbox", { name: "Annotation note" })
    .fill("Account for existing clients.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(state.submit).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Send review to chat", exact: true }).click();
  await vi.waitFor(() => expect(state.submit).toHaveBeenCalledOnce());
  expect(server().draft.annotations).toMatchObject([
    {
      sectionId: "approach",
      questionId: "approach-question",
      quote: "Which approach should we take?",
      body: "Account for existing clients.",
    },
  ]);
});

it("defers and resumes a question without losing its selected answer or notes", async () => {
  const artifact = setup("2030-01-01T12:00:00.000Z");
  await using screen = await render(panel(artifact));
  await page.getByRole("radio", { name: /Use the existing interface/ }).click();
  await page.getByRole("textbox", { name: /^Notes:/ }).fill("Need the team's input.");
  await page.getByRole("checkbox", { name: "Defer this question" }).click();
  expect(state.submit).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Send review to chat", exact: true }).click();
  await vi.waitFor(() => expect(state.submit).toHaveBeenCalledOnce());
  await expect
    .element(page.getByRole("button", { name: "Remind me later", exact: true }))
    .toBeVisible();
  expect(server().draft.answers["approach-question"]).toEqual({
    selectedOptionIds: ["existing"],
    notes: "Need the team's input.",
    deferred: true,
  });
  await page.getByRole("checkbox", { name: "Defer this question" }).click();
  await expect
    .element(page.getByRole("radio", { name: /Use the existing interface/ }))
    .toBeChecked();
  expect(state.submit).toHaveBeenCalledOnce();
  await page.getByRole("button", { name: "Send review to chat", exact: true }).click();
  await vi.waitFor(() => expect(state.submit).toHaveBeenCalledTimes(2));
  expect(server().draft.answers["approach-question"]?.deferred).toBe(false);
  const saved = server();
  await act(() =>
    appAtomRegistry.set(
      state.list as Atom.Writable<AsyncResult.AsyncResult<ReadonlyArray<ReviewSummary>>>,
      AsyncResult.success([
        {
          id: saved.id,
          threadId: saved.threadId,
          title: saved.content.title,
          revision: saved.revision,
          lastSubmittedRevision: saved.lastSubmission?.revision ?? null,
          remindAt: saved.draft.remindAt,
          updatedAt: saved.updatedAt,
        },
      ]),
    ),
  );
  await screen.rerender(panel(artifact, 420, null));
  await expect.element(page.getByText("Sent", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Deferred", { exact: true })).not.toBeInTheDocument();
});

it("preserves dirty notes on a remote update and requires an explicit conflict choice", async () => {
  const artifact = setup();
  await using _screen = await render(panel(artifact));
  await page.getByRole("textbox", { name: "Overall review notes" }).fill("My unsent notes");
  const remote = {
    ...artifact,
    revision: 2,
    draft: { ...artifact.draft, notes: "Saved elsewhere" },
  };
  state.server = remote;
  await act(() =>
    appAtomRegistry.set(
      state.artifact as Atom.Writable<AsyncResult.AsyncResult<ReviewArtifact>>,
      AsyncResult.success(remote),
    ),
  );
  await expect
    .element(page.getByRole("textbox", { name: "Overall review notes" }))
    .toHaveValue("My unsent notes");
  await expect
    .element(page.getByRole("button", { name: "Send review to chat", exact: true }))
    .toBeDisabled();
  await page.getByRole("button", { name: "Use saved answers", exact: true }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Overall review notes" }))
    .toHaveValue("Saved elsewhere");
  expect(state.submit).not.toHaveBeenCalled();
});

it("keeps the compact outline and review actions reachable at narrow and wide widths", async () => {
  const artifact = setup();
  const previousViewport = { width: window.innerWidth, height: window.innerHeight };
  await using _viewport = {
    async [Symbol.asyncDispose]() {
      await page.viewport(previousViewport.width, previousViewport.height);
    },
  };
  await page.viewport(1200, 1000);
  await using screen = await render(panel(artifact, 380));
  await page.getByRole("button", { name: "Review outline" }).click();
  await expect.element(page.getByRole("navigation", { name: "Review sections" })).toBeVisible();
  await page.getByRole("button", { name: "Review outline" }).click();
  await expect
    .element(page.getByRole("button", { name: "Send review to chat", exact: true }))
    .toBeVisible();
  await screen.rerender(panel(artifact, 980));
  await page.getByRole("button", { name: "Review outline" }).click();
  await expect.element(page.getByRole("navigation", { name: "Review sections" })).toBeVisible();
  await page.getByRole("button", { name: "Review outline" }).click();
  await expect
    .element(page.getByRole("button", { name: "Send review to chat", exact: true }))
    .toBeVisible();
});

it.each([
  { supported: false, startedThread: true },
  { supported: true, startedThread: false },
])("keeps an unavailable review tab from querying: %j", async ({ supported, startedThread }) => {
  const artifact = setup();
  state.supported = supported;
  await using _screen = await render(panel(artifact, 420, artifact.id, startedThread));
  await expect
    .element(page.getByRole("button", { name: "Send review to chat", exact: true }))
    .not.toBeInTheDocument();
  expect(state.queryList).not.toHaveBeenCalled();
  expect(state.queryGet).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
  expect(state.submit).not.toHaveBeenCalled();
});
