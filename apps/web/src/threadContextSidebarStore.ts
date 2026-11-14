import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";
import { nextSidebarView, toggleThreadToolsView } from "./threadContextSidebar";

export type ThreadContextSection =
  | "list"
  | "artifacts"
  | "marks"
  | "related"
  | "details"
  | "environments"
  | "context"
  | "ticket";

export type SidebarView = "threads" | ThreadContextSection;

interface ThreadContextSidebarState {
  view: SidebarView;
  lastTool: ThreadContextSection;
  pinned: ScopedThreadRef | null;
  environmentSelection: { thread: ScopedThreadRef; id: string } | null;
  /** Set when a tool view was requested while the sidebar may be hidden; the sidebar clears it. */
  revealPending: boolean;
  /** Where the Details view hosts the conversation's details card while it is showing. */
  detailsElement: HTMLDivElement | null;
  selectView: (view: SidebarView) => void;
  toggleTools: (sidebarVisible: boolean) => void;
  show: (view: ThreadContextSection, thread?: ScopedThreadRef) => void;
  consumeReveal: () => void;
  pin: (thread: ScopedThreadRef | null) => void;
  openList: (thread: ScopedThreadRef) => void;
  openEnvironments: (thread?: ScopedThreadRef, id?: string) => void;
  selectEnvironment: (thread: ScopedThreadRef, id: string | null) => void;
}

export const useThreadContextSidebarStore = create<ThreadContextSidebarState>()(
  persist(
    (set) => ({
      view: "threads",
      lastTool: "list",
      pinned: null,
      environmentSelection: null,
      revealPending: false,
      detailsElement: null,
      selectView: (view) => set((state) => nextSidebarView(state, view)),
      toggleTools: (sidebarVisible) => set((state) => toggleThreadToolsView(state, sidebarVisible)),
      show: (view, thread) =>
        set({ view, lastTool: view, revealPending: true, ...(thread ? { pinned: thread } : {}) }),
      consumeReveal: () => set({ revealPending: false }),
      pin: (pinned) => set({ pinned }),
      openList: (thread) =>
        set({ view: "list", lastTool: "list", pinned: thread, revealPending: true }),
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
      partialize: ({ view, lastTool }) => ({ view, lastTool }),
      // v0 stored the right panel's { open, view }; its view becomes the last tool.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as { view?: SidebarView; lastTool?: ThreadContextSection };
        if (version === 0) {
          return {
            view: "threads",
            lastTool: state.view && state.view !== "threads" ? state.view : "list",
          };
        }
        return state;
      },
    },
  ),
);
