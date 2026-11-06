import {
  AuthOrchestrationOperateScope,
  type ReviewArtifact,
  type ReviewDraft,
} from "@t3tools/contracts";
import { useEffect } from "react";
import { create } from "zustand";

import { persistReviewDraft, submitReviewDraft, type ReviewTarget } from "../../state/reviews";
import { readEnvironmentScope } from "../../state/session";

export interface ReviewEditSession {
  readonly artifact: ReviewArtifact;
  readonly remote: ReviewArtifact;
  readonly draft: ReviewDraft;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly conflict: boolean;
}

const useDrafts = create<Readonly<Record<string, ReviewEditSession>>>(() => ({}));
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const saves = new Map<string, Promise<boolean>>();
const submissions = new Map<string, Promise<boolean>>();
const keyOf = (target: ReviewTarget) => `${target.environmentId}:${target.reviewId}`;
const read = (target: ReviewTarget) => useDrafts.getState()[keyOf(target)];
const change = (
  target: ReviewTarget,
  update: (session: ReviewEditSession) => ReviewEditSession,
) => {
  const key = keyOf(target);
  useDrafts.setState((all) => (all[key] ? { ...all, [key]: update(all[key]) } : all), true);
};

function receiveReview(target: ReviewTarget, artifact: ReviewArtifact): void {
  const current = read(target);
  if (!current) {
    useDrafts.setState({
      [keyOf(target)]: {
        artifact,
        remote: artifact,
        draft: artifact.draft,
        dirty: false,
        saving: false,
        submitting: false,
        error: null,
        conflict: false,
      },
    });
    return;
  }
  if (artifact.revision < current.artifact.revision) return;
  if (
    artifact.revision === current.artifact.revision &&
    current.artifact.lastSubmission?.revision === current.artifact.revision &&
    artifact.lastSubmission?.revision !== artifact.revision
  )
    return;
  change(target, (session) =>
    session.dirty || session.saving || session.submitting
      ? {
          ...session,
          remote: artifact,
          ...(artifact.revision > session.artifact.revision && !session.saving
            ? {
                conflict: true,
                error: "This review changed on another device. Your answers are still here.",
              }
            : {}),
        }
      : { ...session, artifact, remote: artifact, draft: artifact.draft },
  );
}

export function editReviewDraft(
  target: ReviewTarget,
  update: (draft: ReviewDraft) => ReviewDraft,
): void {
  const current = read(target);
  if (!current || current.submitting) return;
  const draft = update(current.draft);
  if (JSON.stringify(draft) === JSON.stringify(current.draft)) return;
  change(target, (session) => ({
    ...session,
    draft,
    dirty: true,
    error: session.conflict ? session.error : null,
  }));
  const key = keyOf(target);
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      void flushReviewDraft(target);
    }, 500),
  );
}

function failed(target: ReviewTarget, error: unknown): void {
  const conflict =
    typeof error === "object" && error !== null && "code" in error && error.code === "conflict";
  change(target, (session) => ({
    ...session,
    conflict,
    error:
      error instanceof Error
        ? error.message
        : "Could not save this review. Your answers are still here.",
  }));
}

export async function flushReviewDraft(target: ReviewTarget): Promise<boolean> {
  const key = keyOf(target);
  clearTimeout(timers.get(key));
  timers.delete(key);
  const previous = saves.get(key);
  if (previous) {
    if (!(await previous)) return false;
    return flushReviewDraft(target);
  }
  const session = read(target);
  if (!session || session.conflict) return false;
  if (!session.dirty) return true;
  if (!readEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope)) {
    failed(target, new Error("This connection cannot save review answers."));
    return false;
  }
  const draft = session.draft;
  change(target, (current) => ({ ...current, saving: true, error: null }));
  const pending = (async () => {
    try {
      const artifact = await persistReviewDraft(target, session.artifact.revision, draft);
      change(target, (current) => ({
        ...current,
        artifact,
        remote: artifact,
        dirty: current.draft !== draft,
        error: null,
      }));
      return true;
    } catch (error) {
      failed(target, error);
      return false;
    } finally {
      change(target, (current) => ({ ...current, saving: false }));
      saves.delete(key);
    }
  })();
  saves.set(key, pending);
  if (!(await pending)) return false;
  return read(target)?.dirty ? flushReviewDraft(target) : true;
}

export function sendReview(target: ReviewTarget): Promise<boolean> {
  const key = keyOf(target);
  const previous = submissions.get(key);
  if (previous) return previous;
  change(target, (session) => ({ ...session, submitting: true, error: null }));
  const pending = (async () => {
    try {
      if (!(await flushReviewDraft(target))) return false;
      const current = read(target);
      if (!current) return false;
      const artifact = await submitReviewDraft(target, current.artifact.revision);
      change(target, (session) => ({ ...session, artifact, remote: artifact, error: null }));
      return true;
    } catch (error) {
      failed(target, error);
      return false;
    } finally {
      change(target, (session) => ({ ...session, submitting: false }));
      submissions.delete(key);
    }
  })();
  submissions.set(key, pending);
  return pending;
}

export function resolveReviewConflict(target: ReviewTarget, keepLocal: boolean): void {
  change(target, (session) => ({
    ...session,
    artifact: session.remote,
    draft: keepLocal ? session.draft : session.remote.draft,
    dirty: keepLocal,
    conflict: false,
    error: null,
  }));
  if (keepLocal) void flushReviewDraft(target);
}

export function useReviewDraft(
  target: ReviewTarget,
  artifact: ReviewArtifact,
): ReviewEditSession | undefined {
  const { environmentId, reviewId } = target;
  const key = keyOf(target);
  const session = useDrafts((all) => all[key]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- accepts remote snapshots without replacing shared unsaved answers.
  useEffect(() => {
    receiveReview({ environmentId, reviewId }, artifact);
  }, [environmentId, reviewId, artifact]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a panel switch flushes the shared session; the write outlives the surface.
  useEffect(() => {
    return () => {
      void flushReviewDraft({ environmentId, reviewId });
    };
  }, [environmentId, reviewId]);
  return session;
}
