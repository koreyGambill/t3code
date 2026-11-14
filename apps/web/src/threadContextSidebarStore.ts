import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";
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
  | "details"
  | "environments"
  | "inspect";

export type SidebarView = "threads" | ThreadContextSection;

/** Everything on the strip a viewer can hide; the thread list always stays. */
export type StripItem = ThreadContextSection | "status";

interface ThreadContextSidebarState {
  view: SidebarView;
  lastTool: ThreadContextSection;
  pinned: ScopedThreadRef | null;
  hidden: ReadonlyArray<StripItem>;
  environmentSelection: { thread: ScopedThreadRef; id: string } | null;
  /** Set when a tool view was requested while the sidebar may be hidden; the sidebar clears it. */
  revealPending: boolean;
  /** Where the Details view hosts the conversation's details card while it is showing. */
  detailsElement: HTMLDivElement | null;
  /** The sidebar header slot where the open tool view puts its own buttons. */
  actionsElement: HTMLDivElement | null;
  selectView: (view: SidebarView) => void;
  toggleTools: (sidebarVisible: boolean) => void;
  show: (view: ThreadContextSection, thread?: ScopedThreadRef) => void;
  consumeReveal: () => void;
  pin: (thread: ScopedThreadRef | null) => void;
  setHidden: (item: StripItem, hidden: boolean) => void;
  openTodos: (thread: ScopedThreadRef) => void;
  openEnvironments: (thread?: ScopedThreadRef, id?: string) => void;
  selectEnvironment: (thread: ScopedThreadRef, id: string | null) => void;
}

export const useThreadContextSidebarStore = create<ThreadContextSidebarState>()(
  persist(
    (set) => ({
      view: "threads",
      lastTool: "todos",
      pinned: null,
      hidden: [],
      environmentSelection: null,
      revealPending: false,
      detailsElement: null,
      actionsElement: null,
      selectView: (view) => set((state) => nextSidebarView(state, view)),
      toggleTools: (sidebarVisible) => set((state) => toggleThreadToolsView(state, sidebarVisible)),
      show: (view, thread) =>
        set({ view, lastTool: view, revealPending: true, ...(thread ? { pinned: thread } : {}) }),
      consumeReveal: () => set({ revealPending: false }),
      pin: (pinned) => set({ pinned }),
      setHidden: (item, hide) =>
        set((state) => ({
          hidden: hide
            ? [...state.hidden.filter((entry) => entry !== item), item]
            : state.hidden.filter((entry) => entry !== item),
          ...(hide && state.view === item ? { view: "threads" as const } : {}),
          ...(hide && state.lastTool === item
            ? { lastTool: firstVisibleThreadTool([...state.hidden, item]) }
            : {}),
        })),
      openTodos: (thread) =>
        set({ view: "todos", lastTool: "todos", pinned: thread, revealPending: true }),
      openEnvironments: (thread, id) =>
        set({
          view: "environments",
          lastTool: "environments",
          revealPending: true,
          ...(thread ? { pinned: thread } : {}),
          environmentSelection: thread && id ? { thread, id } : null,
        }),
      selectEnvironment: (thread, id) => set({ environmentSelection: id ? { thread, id } : null }),
    }),
    {
      name: "t3code:thread-context-sidebar",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: ({ view, lastTool, hidden }) => ({ view, lastTool, hidden }),
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
