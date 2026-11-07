import type { ThreadId } from "@t3tools/contracts";

export const THREAD_ATTENTION_DURATION_MS = 1000;

type ThreadAttention = {
  readonly threadId: ThreadId;
  readonly seed: number | undefined;
  readonly title: string;
  readonly sequence: number;
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
  timer = setTimeout(() => {
    current = null;
    emit();
  }, THREAD_ATTENTION_DURATION_MS);
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
