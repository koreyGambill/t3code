import {
  WS_METHODS,
  type EnvironmentId,
  type ReviewArtifact,
  type ReviewDraft,
  type ReviewId,
} from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

export const reviewArtifactsList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "reviews:list",
  tag: WS_METHODS.reviewsList,
  staleTimeMs: 5_000,
  refreshIntervalMs: 5_000,
  idleTtlMs: 0,
});
export const reviewArtifactGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "reviews:get",
  tag: WS_METHODS.reviewsGet,
  staleTimeMs: 5_000,
  refreshIntervalMs: 5_000,
  idleTtlMs: 0,
});
export const reviewArtifactsDue = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "reviews:due",
  tag: WS_METHODS.reviewsDue,
  staleTimeMs: 60_000,
  refreshIntervalMs: 60_000,
  idleTtlMs: 0,
});
export const reviewArtifactCreate = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "reviews:create",
  tag: WS_METHODS.reviewsCreate,
});
const save = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "reviews:save",
  tag: WS_METHODS.reviewsSave,
});
const submit = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "reviews:submit",
  tag: WS_METHODS.reviewsSubmit,
});

export interface ReviewTarget {
  readonly environmentId: EnvironmentId;
  readonly reviewId: ReviewId;
}

export async function persistReviewDraft(
  target: ReviewTarget,
  expectedRevision: number,
  draft: ReviewDraft,
): Promise<ReviewArtifact> {
  const result = await runAtomCommand(appAtomRegistry, save, {
    environmentId: target.environmentId,
    input: { reviewId: target.reviewId, expectedRevision, draft },
  });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  appAtomRegistry.refresh(reviewArtifactsDue({ environmentId: target.environmentId, input: {} }));
  return result.value;
}

export async function submitReviewDraft(
  target: ReviewTarget,
  expectedRevision: number,
): Promise<ReviewArtifact> {
  const result = await runAtomCommand(appAtomRegistry, submit, {
    environmentId: target.environmentId,
    input: { reviewId: target.reviewId, expectedRevision },
  });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  appAtomRegistry.refresh(reviewArtifactsDue({ environmentId: target.environmentId, input: {} }));
  return result.value;
}
