import { EnvironmentId, ThreadId, type ThreadWorkspace } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  nextSidebarView,
  selectContextThread,
  summarizeThreadTools,
  toggleThreadToolsView,
} from "./threadContextSidebar";
import { applyTileAction, syncTileLayout } from "./threadTileLayout";
import { useThreadContextSidebarStore } from "./threadContextSidebarStore";

const owner = { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("owner") };
const child = { environmentId: owner.environmentId, threadId: ThreadId.make("child") };
const surfaces = [{ id: "side-chat:child", kind: "side-chat", threadId: child.threadId }] as const;

describe("thread context sidebar selection", () => {
  it("follows the active thread through split, floating, maximized and Focus layouts", () => {
    const split = syncTileLayout(undefined, [], ["side-chat:child"], "side-chat:child", true);
    expect(selectContextThread(owner, split, surfaces, null)).toEqual(child);
    const mainGroup = split.root.kind === "split" ? split.root.first.id : "";
    const main = applyTileAction(split, { type: "focus", groupId: mainGroup });
    expect(selectContextThread(owner, main, surfaces, null)).toEqual(owner);
    const floating = applyTileAction(split, {
      type: "float-group",
      groupId: "panels-group",
      rect: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
    });
    expect(selectContextThread(owner, floating, surfaces, null)).toEqual(child);
    const maximized = applyTileAction(floating, { type: "maximize", groupId: "panels-group" });
    expect(selectContextThread(owner, maximized, surfaces, null)).toEqual(child);
    const focus = applyTileAction(split, { type: "focus-pair", groupId: "panels-group" });
    expect(selectContextThread(owner, focus, surfaces, null)).toEqual(child);
    const left = applyTileAction(focus, { type: "focus", groupId: "focus-left-group" });
    expect(selectContextThread(owner, left, surfaces, null)).toEqual(owner);
  });

  it("keeps a pinned thread across focus and environment changes, then resumes following", () => {
    useThreadContextSidebarStore.setState(useThreadContextSidebarStore.getInitialState());
    const store = useThreadContextSidebarStore.getState();
    store.pin(child);
    const other = { environmentId: EnvironmentId.make("remote"), threadId: owner.threadId };
    expect(
      selectContextThread(other, null, [], useThreadContextSidebarStore.getState().pinned),
    ).toEqual(child);
    store.pin(null);
    expect(
      selectContextThread(other, null, [], useThreadContextSidebarStore.getState().pinned),
    ).toEqual(other);
    expect(selectContextThread(null, null, [], null)).toBeNull();
  });
});

describe("sidebar views", () => {
  it("returns to threads from the active tool and remembers the last tool", () => {
    const tools = { view: "threads", lastTool: "list" } as const;
    const artifacts = nextSidebarView(tools, "artifacts");
    expect(artifacts).toEqual({ view: "artifacts", lastTool: "artifacts" });
    expect(nextSidebarView(artifacts, "artifacts")).toEqual({
      view: "threads",
      lastTool: "artifacts",
    });
    expect(nextSidebarView(artifacts, "threads")).toEqual({
      view: "threads",
      lastTool: "artifacts",
    });
  });

  it("toggles between threads and the last tool, opening a hidden sidebar on a tool", () => {
    const threads = { view: "threads", lastTool: "marks" } as const;
    expect(toggleThreadToolsView(threads, true)).toEqual({
      view: "marks",
      lastTool: "marks",
      revealPending: false,
    });
    expect(toggleThreadToolsView({ view: "marks", lastTool: "marks" }, true)).toEqual({
      view: "threads",
      lastTool: "marks",
      revealPending: false,
    });
    expect(toggleThreadToolsView(threads, false)).toEqual({
      view: "marks",
      lastTool: "marks",
      revealPending: true,
    });
    expect(toggleThreadToolsView({ view: "ticket", lastTool: "ticket" }, false)).toMatchObject({
      view: "ticket",
      revealPending: true,
    });
  });
});

describe("thread tool signals", () => {
  const workspace = (
    items: ThreadWorkspace["items"],
    artifacts: ThreadWorkspace["artifacts"] = [],
  ): ThreadWorkspace => ({
    threadId: owner.threadId,
    revision: 1,
    items,
    artifacts,
    summaryNotes: "",
    childPreamble: "",
    updatedAt: null,
  });
  const item = (
    state: ThreadWorkspace["items"][number]["state"],
    linkStates?: ThreadWorkspace["items"][number]["linkStates"],
  ): ThreadWorkspace["items"][number] => ({
    id: `item-${state}`,
    text: state,
    state,
    owner: "agent",
    createdAt: "2026-11-13T00:00:00.000Z",
    doneAt: null,
    details: "",
    parentId: null,
    links: [],
    needsQa: false,
    ...(linkStates ? { linkStates } : {}),
  });

  it("counts open items, unanswered latest questions and the first ticket state", () => {
    const question = (id: string) => ({
      id,
      prompt: id,
      options: [],
      recommendedOptionIds: [],
      multiSelect: false,
    });
    const signals = summarizeThreadTools(
      workspace(
        [
          item("open", [{ type: "ticket", target: "BW-1", state: "closed", label: "Done" }]),
          item("done"),
          item("dropped"),
        ],
        [
          {
            id: "a",
            title: "A",
            format: "markdown",
            versions: [
              {
                version: 1,
                title: "A",
                format: "markdown",
                content: "",
                createdAt: "2026-11-13T00:00:00.000Z",
                questions: [question("old")],
                answers: {},
              },
              {
                version: 2,
                title: "A",
                format: "markdown",
                content: "",
                createdAt: "2026-11-13T00:00:00.000Z",
                questions: [question("answered"), question("open")],
                answers: {
                  answered: {
                    chosenOptionIds: [],
                    notes: "",
                    submittedAt: "2026-11-13T00:00:00.000Z",
                  },
                },
              },
            ],
          },
        ],
      ),
    );
    expect(signals).toEqual({ listCount: 1, questionCount: 1, ticketState: "closed" });
    expect(summarizeThreadTools(null)).toEqual({
      listCount: 0,
      questionCount: 0,
      ticketState: null,
    });
  });
});
