import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";
import type { TodoFilter } from "./components/reviews/todoList.logic";
import {
  firstVisibleThreadTool,
  migrateThreadToolsView,
  nextSidebarView,
  toggleThreadToolsView,
} from "./threadContextSidebar";

export type ThreadContextSection =
  | "todos"
  | "artifacts"
  | "links"
  | "related"
  | "timeline"
  | "details"
  | "environments"
  | "inspect";

export type SidebarView = "threads" | ThreadContextSection;

/** Everything on the strip a viewer can hide; the thread list always stays. */
export type StripItem = ThreadContextSection | "status";

export interface ShowTarget {
  /** Pins the tools to this thread. */
  readonly thread?: ScopedThreadRef;
  readonly artifactId?: string;
  /** The thread the artifact belongs to, when it shouldn't pin the tools to that thread. */
  readonly artifactThread?: ScopedThreadRef;
  readonly environmentId?: string;
}

interface ThreadContextSidebarState {
  view: SidebarView;
  lastTool: ThreadContextSection;
  pinned: ScopedThreadRef | null;
  hidden: ReadonlyArray<StripItem>;
  todoFilter: TodoFilter;
  todoShowClosed: boolean;
  environmentSelection: { thread: ScopedThreadRef; id: string } | null;
  /** Set when a tool view was requested while the sidebar may be hidden; the sidebar clears it. */
  revealPending: boolean;
  /** The artifact the Artifacts view opens on, for its thread only; null lists them all. */
  artifactSelection: { thread: ScopedThreadRef | null; id: string } | null;
  selectView: (view: SidebarView) => void;
  toggleTools: (sidebarVisible: boolean) => void;
  /** Opens a tool from outside the strip, unhiding it, and reveals a hidden sidebar. */
  show: (view: ThreadContextSection, target?: ShowTarget) => void;
  selectArtifact: (thread: ScopedThreadRef, id: string | null) => void;
  consumeReveal: () => void;
  pin: (thread: ScopedThreadRef | null) => void;
  setHidden: (item: StripItem, hidden: boolean) => void;
  setTodoFilter: (filter: TodoFilter) => void;
  setTodoShowClosed: (show: boolean) => void;
  selectEnvironment: (thread: ScopedThreadRef, id: string | null) => void;
}

export const useThreadContextSidebarStore = create<ThreadContextSidebarState>()(
  persist(
    (set) => ({
      view: "threads",
      lastTool: "todos",
      pinned: null,
      hidden: [],
      todoFilter: "all",
      todoShowClosed: false,
      environmentSelection: null,
      revealPending: false,
      artifactSelection: null,
      selectView: (view) =>
        set((state) => ({
          ...nextSidebarView(state, view),
          ...(view === "artifacts" ? { artifactSelection: null } : {}),
        })),
      toggleTools: (sidebarVisible) => set((state) => toggleThreadToolsView(state, sidebarVisible)),
      show: (view, target = {}) =>
        set((state) => ({
          view,
          lastTool: view,
          revealPending: true,
          hidden: state.hidden.filter((entry) => entry !== view),
          ...(target.thread ? { pinned: target.thread } : {}),
          ...(view === "artifacts"
            ? {
                artifactSelection: target.artifactId
                  ? {
                      thread: target.thread ?? target.artifactThread ?? null,
                      id: target.artifactId,
                    }
                  : null,
              }
            : {}),
          ...(view === "environments"
            ? {
                environmentSelection:
                  target.thread && target.environmentId
                    ? { thread: target.thread, id: target.environmentId }
                    : null,
              }
            : {}),
        })),
      selectArtifact: (thread, id) => set({ artifactSelection: id ? { thread, id } : null }),
      consumeReveal: () => set({ revealPending: false }),
      pin: (pinned) => set({ pinned }),
      setHidden: (item, hide) =>
        set((state) => ({
          hidden: hide
            ? [...state.hidden.filter((entry) => entry !== item), item]
            : state.hidden.filter((entry) => entry !== item),
          ...(hide && state.view === item ? { view: "threads" as const } : {}),
          ...(hide && state.lastTool === item
            ? { lastTool: firstVisibleThreadTool([...state.hidden, item]) ?? state.lastTool }
            : {}),
        })),
      setTodoFilter: (todoFilter) => set({ todoFilter }),
      setTodoShowClosed: (todoShowClosed) => set({ todoShowClosed }),
      selectEnvironment: (thread, id) => set({ environmentSelection: id ? { thread, id } : null }),
    }),
    {
      name: "t3code:thread-context-sidebar",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: ({ view, lastTool, hidden, todoFilter, todoShowClosed }) => ({
        view,
        lastTool,
        hidden,
        todoFilter,
        todoShowClosed,
      }),
      // v0 stored the right panel's { open, view }; its view becomes the last tool.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as { view?: string };
        return version === 0
          ? { view: "threads", lastTool: migrateThreadToolsView(state.view) }
          : persisted;
      },
    },
  ),
);
