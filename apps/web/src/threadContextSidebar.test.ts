import { EnvironmentId, ThreadId, type ThreadWorkspace } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  firstVisibleThreadTool,
  migrateThreadToolsView,
  nextSidebarView,
  selectContextThread,
  summarizeThreadTools,
  talkedWithThreads,
  threadToolsAttention,
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
    const paired = applyTileAction(
      applyTileAction(split, { type: "maximize", groupId: mainGroup }),
      { type: "show-beside", groupId: "panels-group" },
    );
    expect(selectContextThread(owner, paired, surfaces, null)).toEqual(child);
    const left = applyTileAction(paired, { type: "focus", groupId: mainGroup });
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
    const tools = { view: "threads", lastTool: "todos" } as const;
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
    const threads = { view: "threads", lastTool: "links" } as const;
    expect(toggleThreadToolsView(threads, true)).toEqual({
      view: "links",
      lastTool: "links",
      revealPending: false,
    });
    expect(toggleThreadToolsView({ view: "links", lastTool: "links" }, true)).toEqual({
      view: "threads",
      lastTool: "links",
      revealPending: false,
    });
    expect(toggleThreadToolsView(threads, false)).toEqual({
      view: "links",
      lastTool: "links",
      revealPending: true,
    });
    expect(toggleThreadToolsView({ view: "inspect", lastTool: "inspect" }, false)).toMatchObject({
      view: "inspect",
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

describe("thread tools attention", () => {
  const quiet = { listCount: 0, questionCount: 0, ticketState: null } as const;
  const calm = { state: "ok", unread: 0 } as const;

  it("shows nothing when nothing needs the user", () => {
    expect(threadToolsAttention(quiet, calm)).toBeNull();
    expect(
      threadToolsAttention({ ...quiet, ticketState: "open" }, { ...calm, state: "unknown" }),
    ).toBeNull();
  });

  it("takes its tone from the most urgent signal and lists every one", () => {
    expect(
      threadToolsAttention(
        { listCount: 3, questionCount: 2, ticketState: "needs_review" },
        { state: "fail", unread: 1 },
      ),
    ).toEqual({
      tone: "alert",
      summary:
        "Status alert · 2 unanswered questions · 1 unread watcher alert · Ticket needs review · 3 open todos",
    });
    expect(
      threadToolsAttention(
        { ...quiet, questionCount: 1, listCount: 1 },
        { ...calm, state: "warn" },
      ),
    ).toEqual({
      tone: "question",
      summary: "1 unanswered question · Status warning · 1 open todo",
    });
    expect(threadToolsAttention({ ...quiet, ticketState: "needs_review" }, calm)?.tone).toBe(
      "review",
    );
    expect(threadToolsAttention({ ...quiet, listCount: 4 }, calm)?.tone).toBe("todo");
  });
});

describe("thread tool views", () => {
  it("maps the retired right panel's views onto the sidebar's", () => {
    expect(migrateThreadToolsView("list")).toBe("todos");
    expect(migrateThreadToolsView("marks")).toBe("links");
    expect(migrateThreadToolsView("ticket")).toBe("links");
    expect(migrateThreadToolsView("context")).toBe("inspect");
    expect(migrateThreadToolsView("environments")).toBe("environments");
    expect(migrateThreadToolsView(undefined)).toBe("todos");
    expect(firstVisibleThreadTool(["todos", "artifacts"])).toBe("links");
  });

  it("lists threads this one talked with, not siblings", () => {
    const shell = (id: string, parent: string | null = null, forkOf?: string) => ({
      id,
      title: id,
      lineage: { parentThreadId: parent },
      forkedFrom: forkOf ? { type: "run", threadId: forkOf } : null,
    });
    const self = shell("self", "lead", "origin");
    const related = talkedWithThreads({
      threadId: "self",
      self,
      shells: [
        self,
        shell("lead"),
        shell("origin"),
        shell("worker", "self"),
        shell("sibling", "lead"),
        shell("copy", null, "self"),
        shell("asker"),
        shell("peer"),
        shell("stranger"),
      ],
      messagedBy: new Set(["asker"]),
      transfers: [{ sourceThreadId: "self", targetThreadId: "peer" }],
    });
    expect(related.map(({ entry, relation }) => [entry.id, relation])).toEqual([
      ["lead", "Delegated this thread"],
      ["origin", "Forked from"],
      ["worker", "Delegated to"],
      ["copy", "Fork"],
      ["asker", "Messaged this thread"],
      ["peer", "Shared context"],
    ]);
  });
});
