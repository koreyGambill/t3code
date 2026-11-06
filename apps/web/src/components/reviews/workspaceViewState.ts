import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { WorkspaceGroup } from "@t3tools/contracts";

interface WorkspaceViewState {
  closed: Record<string, boolean>;
  outlineHidden: boolean;
  focusedItem: { key: string; itemId: string } | null;
  focusItem: (key: string, itemId: string) => void;
  toggle: (key: string) => void;
  expand: (threadKey: string, groupId: string, groups: ReadonlyArray<WorkspaceGroup>) => void;
  toggleOutline: () => void;
}
export const useWorkspaceViewState = create(
  persist<WorkspaceViewState>(
    (set) => ({
      closed: {},
      outlineHidden: false,
      focusedItem: null,
      focusItem: (key, itemId) => set({ focusedItem: { key, itemId } }),
      toggle: (key) => set((state) => ({ closed: { ...state.closed, [key]: !state.closed[key] } })),
      expand: (threadKey, groupId, groups) =>
        set((state) => {
          const closed = { ...state.closed };
          const seen = new Set<string>();
          let id: string | null = groupId;
          while (id && !seen.has(id)) {
            seen.add(id);
            closed[`${threadKey}:${id}`] = false;
            closed[`nav:${threadKey}:${id}`] = false;
            id = groups.find((group) => group.id === id)?.parentId ?? null;
          }
          return { closed };
        }),
      toggleOutline: () => set((state) => ({ outlineHidden: !state.outlineHidden })),
    }),
    { name: "t3-workspace-view", partialize: (state) => ({ ...state, focusedItem: null }) },
  ),
);

const viewportPositions = new Map<string, number>();
export function readWorkspaceScroll(key: string): number {
  return viewportPositions.get(key) ?? 0;
}
export function saveWorkspaceScroll(key: string, top: number): void {
  viewportPositions.set(key, top);
}
