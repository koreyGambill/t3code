import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

export type ThreadContextSection =
  | "list"
  | "artifacts"
  | "marks"
  | "related"
  | "details"
  | "environments"
  | "context"
  | "ticket";

interface ThreadContextSidebarState {
  open: boolean;
  pinned: ScopedThreadRef | null;
  view: ThreadContextSection;
  maximized: boolean;
  selectView: (view: ThreadContextSection) => void;
  toggleMaximized: () => void;
  restore: () => void;
  environmentSelection: { thread: ScopedThreadRef; id: string } | null;
  toggle: () => void;
  pin: (thread: ScopedThreadRef | null) => void;
  openList: (thread: ScopedThreadRef) => void;
  openEnvironments: (thread?: ScopedThreadRef, id?: string) => void;
  selectEnvironment: (thread: ScopedThreadRef, id: string | null) => void;
}

export const useThreadContextSidebarStore = create<ThreadContextSidebarState>()(
  persist(
    (set) => ({
      open: false,
      pinned: null,
      view: "list",
      maximized: false,
      selectView: (view) => set((state) => ({ view, open: !state.open || state.view !== view })),
      toggleMaximized: () => set((state) => ({ maximized: !state.maximized })),
      restore: () => set({ maximized: false }),
      environmentSelection: null,
      toggle: () => set((state) => ({ open: !state.open })),
      pin: (pinned) => set({ pinned }),
      openList: (thread) => set({ open: true, pinned: thread, view: "list" }),
      openEnvironments: (thread, id) =>
        set({
          open: true,
          ...(thread ? { pinned: thread } : {}),
          view: "environments",
          environmentSelection: thread && id ? { thread, id } : null,
        }),
      selectEnvironment: (thread, id) => set({ environmentSelection: id ? { thread, id } : null }),
    }),
    {
      name: "t3code:thread-context-sidebar",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: ({ open, view }) => ({ open, view }),
    },
  ),
);
