import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type ThreadWorkspace,
  type ThreadWorkspacePatchInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../../rightPanelStore";

const state = vi.hoisted(() => ({ query: vi.fn(), patch: vi.fn() }));
vi.mock("../../state/threadWorkspace", () => ({
  threadWorkspaceGet: state.query,
  threadWorkspacePatch: "patch",
}));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.patch }));
vi.mock("./useReviewSupport", () => ({ useReviewSupport: () => true }));
vi.mock("./ReviewPanel", () => ({ ReviewPanel: () => <div>Question document</div> }));
vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <div>{text}</div> }));

import { ThreadWorkspacePanel } from "./ThreadWorkspacePanel";

const first = {
  environmentId: EnvironmentId.make("workspace-browser"),
  threadId: ThreadId.make("first"),
};
const second = { ...first, threadId: ThreadId.make("second") };
function setup() {
  const document: ThreadWorkspace = {
    threadId: first.threadId,
    revision: 1,
    updatedAt: null,
    actionItems: [
      {
        id: "access",
        title: "Provide the project name",
        details: "Which project should we use?",
        status: "open",
      },
    ],
    designNotes: "Use the existing interface.",
    summaryNotes: "Waiting for the project name.",
  };
  let server = document;
  const firstAtom = Atom.make(AsyncResult.success(server)).pipe(Atom.keepAlive);
  const firstQuery = Atom.make((get) => get(firstAtom)).pipe(Atom.keepAlive);
  const secondAtom = Atom.make(
    AsyncResult.success({
      ...document,
      threadId: second.threadId,
      actionItems: [],
      designNotes: "Second thread design.",
    }),
  ).pipe(Atom.keepAlive);
  state.query
    .mockReset()
    .mockImplementation(({ input }: { input: { threadId: string } }) =>
      input.threadId === first.threadId ? firstQuery : secondAtom,
    );
  state.patch
    .mockReset()
    .mockImplementation(async ({ input }: { input: ThreadWorkspacePatchInput }) => {
      expect(input.threadId).toBe(first.threadId);
      expect(input.expectedRevision).toBe(server.revision);
      server = {
        ...server,
        actionItems: input.actionItems ?? server.actionItems,
        revision: server.revision + 1,
      };
      appAtomRegistry.set(firstAtom, AsyncResult.success(server));
      return { _tag: "Success", value: server };
    });
  useRightPanelStore.setState({
    byThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
  useRightPanelStore.getState().openReviews(first);
  return { document, firstAtom, getServer: () => server };
}
function Panel({ threadRef = first }: { threadRef?: ScopedThreadRef }) {
  const surface = useRightPanelStore((store) =>
    selectActiveRightPanelSurface(store.byThreadKey, threadRef),
  );
  const section =
    surface?.kind === "reviews" ? (surface.workspaceSection ?? "questions") : "questions";
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <div className="flex h-[760px] w-[420px] bg-background text-foreground">
        <ThreadWorkspacePanel
          threadRef={threadRef}
          section={section}
          reviewId={null}
          visible
          startedThread
        />
      </div>
    </RegistryContext.Provider>
  );
}

it("saves action status, handles another writer, and keeps each thread's notes separate", async () => {
  const fixture = setup();
  await using screen = await render(<Panel />);
  await page.getByRole("tab", { name: "Action items", exact: true }).click();
  await page.getByRole("button", { name: "Defer", exact: true }).click();
  await expect.element(page.getByText("Deferred", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await page.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect.element(page.getByText("Done", { exact: true })).toBeVisible();
  expect(fixture.getServer().actionItems[0]?.status).toBe("done");
  state.patch.mockImplementationOnce(async () => {
    appAtomRegistry.set(
      fixture.firstAtom,
      AsyncResult.success({
        ...fixture.getServer(),
        revision: 5,
        actionItems: [{ ...fixture.document.actionItems[0]!, status: "deferred" }],
      }),
    );
    return {
      _tag: "Failure",
      cause: Cause.fail(new Error("Workspace changed. Refresh before updating.")),
    };
  });
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect.element(page.getByText("Deferred", { exact: true })).toBeVisible();
  let completeSave!: (result: { _tag: "Success"; value: ThreadWorkspace }) => void;
  state.patch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completeSave = resolve;
      }),
  );
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await page.getByRole("tab", { name: "Design notes", exact: true }).click();
  await expect
    .element(page.getByText("Use the existing interface.", { exact: true }))
    .toBeVisible();
  useRightPanelStore.getState().openReviews(second);
  useRightPanelStore.getState().setWorkspaceSection(second, "design-notes");
  await screen.rerender(<Panel threadRef={second} />);
  await expect.element(page.getByText("Second thread design.", { exact: true })).toBeVisible();
  completeSave({
    _tag: "Success",
    value: {
      ...fixture.document,
      revision: 6,
      designNotes: "Late response from the first thread.",
    },
  });
  await expect.element(page.getByText("Second thread design.", { exact: true })).toBeVisible();
  await screen.rerender(<Panel />);
  await expect
    .element(page.getByText("Use the existing interface.", { exact: true }))
    .toBeVisible();
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  await expect
    .element(page.getByText("Waiting for the project name.", { exact: true }))
    .toBeVisible();
  await page.getByRole("tab", { name: "Questions", exact: true }).click();
  await expect.element(page.getByText("Question document", { exact: true })).toBeVisible();
});
