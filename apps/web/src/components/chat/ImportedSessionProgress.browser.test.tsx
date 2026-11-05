import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId, type AgentSessionProgressResult } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { appAtomRegistry } from "../../rpc/atomRegistry";

type Progress = AsyncResult.AsyncResult<AgentSessionProgressResult, Error>;
const state = vi.hoisted(() => ({
  progress: null as unknown,
  observed: null as unknown,
  canRead: null as unknown,
  subscribed: vi.fn(),
  unsubscribed: vi.fn(),
}));

vi.mock(import("../../state/agentSessions"), () => ({
  agentSessionProgress: (() => state.observed) as never,
}));
vi.mock(import("../../state/session"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useEnvironmentScope: () => useAtomValue(state.canRead as Atom.Atom<boolean>),
  };
});

import { ImportedSessionProgress } from "./ImportedSessionProgress";

const threadRef = {
  environmentId: EnvironmentId.make("wsl"),
  threadId: ThreadId.make("import:claudeAgent:terminal-session"),
};
const firstMessage = {
  role: "user" as const,
  text: "Inspect the project",
  createdAt: "2026-11-05T12:00:00.000Z",
};
const initial: AgentSessionProgressResult = {
  status: "following",
  messages: [firstMessage],
  updatedAt: firstMessage.createdAt,
  truncated: false,
};

function setup() {
  state.subscribed.mockReset();
  state.unsubscribed.mockReset();
  state.canRead = Atom.make(true);
  state.progress = Atom.make<Progress>(AsyncResult.success(initial));
  state.observed = Atom.make((get) => {
    state.subscribed();
    get.addFinalizer(state.unsubscribed);
    return get(state.progress as Atom.Atom<Progress>);
  }).pipe(Atom.setIdleTTL(0));
}

function update(value: Progress) {
  appAtomRegistry.set(state.progress as Atom.Writable<Progress>, value);
}

it("updates terminal messages and preserves them through a failed refresh until T3 continues", async () => {
  setup();
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <ImportedSessionProgress threadRef={threadRef} timestampFormat="24-hour" />
    </RegistryContext.Provider>,
  );
  await expect.element(page.getByText(firstMessage.text, { exact: true })).toBeVisible();
  const appended: AgentSessionProgressResult = {
    ...initial,
    messages: [
      firstMessage,
      { role: "assistant", text: "The checks passed", createdAt: "2026-11-05T12:01:00.000Z" },
    ],
    updatedAt: "2026-11-05T12:01:00.000Z",
  };
  await act(() => update(AsyncResult.success(appended)));
  await expect.element(page.getByText("The checks passed", { exact: true })).toBeVisible();
  await act(() =>
    update(
      AsyncResult.failure(Cause.fail(new Error("connection lost")), {
        previousSuccess: Option.some(AsyncResult.success(appended)),
      }),
    ),
  );
  await expect.element(page.getByText("The checks passed", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("status")).toBeVisible();

  await act(() => update(AsyncResult.success({ ...appended, status: "continued" })));
  await expect
    .element(page.getByRole("button", { name: "Terminal activity" }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByText("The checks passed", { exact: true }))
    .not.toBeInTheDocument();
});

it("stops observing when collapsed or read permission is removed, and resumes when expanded", async () => {
  setup();
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <ImportedSessionProgress threadRef={threadRef} timestampFormat="24-hour" />
    </RegistryContext.Provider>,
  );
  await expect.element(page.getByText(firstMessage.text, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Terminal activity" }).click();
  await vi.waitFor(() => expect(state.unsubscribed).toHaveBeenCalledOnce());
  await page.getByRole("button", { name: "Terminal activity" }).click();
  await vi.waitFor(() => expect(state.subscribed).toHaveBeenCalledTimes(2));
  await act(() => appAtomRegistry.set(state.canRead as Atom.Writable<boolean>, false));
  await vi.waitFor(() => expect(state.unsubscribed).toHaveBeenCalledTimes(2));
  await expect
    .element(page.getByRole("button", { name: "Terminal activity" }))
    .not.toBeInTheDocument();
});

it("clears terminal messages when the source transcript becomes unavailable", async () => {
  setup();
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <ImportedSessionProgress threadRef={threadRef} timestampFormat="24-hour" />
    </RegistryContext.Provider>,
  );
  await expect.element(page.getByText(firstMessage.text, { exact: true })).toBeVisible();
  await act(() =>
    update(
      AsyncResult.success({
        status: "unavailable",
        messages: [],
        updatedAt: null,
        truncated: false,
      }),
    ),
  );
  await expect.element(page.getByText(firstMessage.text, { exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole("status")).toBeVisible();
});
