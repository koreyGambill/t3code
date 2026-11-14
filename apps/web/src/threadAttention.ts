import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { visibleTileGroups } from "./threadTileGeometry";
import { CONVERSATION_TAB_ID, type ThreadTileLayout } from "./threadTileLayout";

export const THREAD_ATTENTION_DURATION_MS = 1000;
export const THREAD_PANE_ATTENTION_DURATION_MS = 750;

export function isThreadVisible(
  thread: ScopedThreadRef,
  route: ScopedThreadRef | null,
  layout: ThreadTileLayout,
  documentVisible: boolean,
) {
  if (!documentVisible || route === null || route.environmentId !== thread.environmentId)
    return false;
  const tabId =
    thread.threadId === route.threadId ? CONVERSATION_TAB_ID : `side-chat:${thread.threadId}`;
  return visibleTileGroups(layout).some((group) => group.activeTabId === tabId);
}

type ThreadAttention = {
  readonly threadId: ThreadId;
  readonly seed: number | undefined;
  readonly title: string;
  readonly sequence: number;
  readonly environmentId?: EnvironmentId;
  readonly presentation?: "pane" | "overlay";
};

let current: ThreadAttention | null = null;
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export function showThreadAttention(alert: Omit<ThreadAttention, "sequence">) {
  clearTimeout(timer);
  current = { ...alert, sequence: ++sequence };
  emit();
  timer = setTimeout(
    () => {
      current = null;
      emit();
    },
    alert.presentation === "pane"
      ? THREAD_PANE_ATTENTION_DURATION_MS
      : THREAD_ATTENTION_DURATION_MS,
  );
}

export const readThreadAttention = () => current;

export function subscribeThreadAttention(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timer);
      current = null;
    }
  };
}
