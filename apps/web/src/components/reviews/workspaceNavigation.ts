import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WorkspaceVisit {
  readonly ref: ScopedThreadRef;
  readonly title: string;
}
interface NavigationState {
  recent: WorkspaceVisit[];
  stack: WorkspaceVisit[];
  cursor: number;
  pendingKey: string | null;
  visit: (visit: WorkspaceVisit) => void;
  move: (direction: -1 | 1) => WorkspaceVisit | null;
}
export const useWorkspaceNavigation = create(
  persist<NavigationState>(
    (set, get) => ({
      recent: [],
      stack: [],
      cursor: -1,
      pendingKey: null,
      visit: (visit) =>
        set((state) => {
          const key = scopedThreadKey(visit.ref);
          const recent = [
            visit,
            ...state.recent.filter((entry) => scopedThreadKey(entry.ref) !== key),
          ].slice(0, 100);
          if (
            state.pendingKey === key ||
            (state.cursor >= 0 && scopedThreadKey(state.stack[state.cursor]!.ref) === key)
          )
            return { recent, pendingKey: null };
          const stack = [...state.stack.slice(0, state.cursor + 1), visit].slice(-100);
          return { recent, stack, cursor: stack.length - 1, pendingKey: null };
        }),
      move: (direction) => {
        const state = get();
        const cursor = state.cursor + direction;
        const target = state.stack[cursor];
        if (!target) return null;
        set({ cursor, pendingKey: scopedThreadKey(target.ref) });
        return target;
      },
    }),
    { name: "t3-workspace-navigation", partialize: (state) => ({ ...state, pendingKey: null }) },
  ),
);
