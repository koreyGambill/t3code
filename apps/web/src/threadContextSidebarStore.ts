import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

export type ThreadContextSection =
  | "marks"
  | "related"
  | "details"
  | "environments"
  | "context"
  | "ticket";

interface ThreadContextSidebarState {
  open: boolean;
  pinned: ScopedThreadRef | null;
  expanded: Partial<Record<ThreadContextSection, boolean>>;
  environmentSelection: { thread: ScopedThreadRef; id: string } | null;
  toggle: () => void;
  pin: (thread: ScopedThreadRef | null) => void;
  setExpanded: (section: ThreadContextSection, expanded: boolean) => void;
  openEnvironments: (thread?: ScopedThreadRef, id?: string) => void;
  selectEnvironment: (thread: ScopedThreadRef, id: string | null) => void;
}

export const useThreadContextSidebarStore = create<ThreadContextSidebarState>()(
  persist(
    (set) => ({
      open: false,
      pinned: null,
      expanded: { marks: true },
      environmentSelection: null,
      toggle: () => set((state) => ({ open: !state.open })),
      pin: (pinned) => set({ pinned }),
      setExpanded: (section, expanded) =>
        set((state) => ({ expanded: { ...state.expanded, [section]: expanded } })),
      openEnvironments: (thread, id) =>
        set((state) => ({
          open: true,
          ...(thread ? { pinned: thread } : {}),
          expanded: { ...state.expanded, environments: true },
          environmentSelection: thread && id ? { thread, id } : null,
        })),
      selectEnvironment: (thread, id) => set({ environmentSelection: id ? { thread, id } : null }),
    }),
    {
      name: "t3code:thread-context-sidebar",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: ({ open, expanded }) => ({ open, expanded }),
    },
  ),
);
