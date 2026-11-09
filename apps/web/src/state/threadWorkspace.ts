import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";
import { Atom } from "effect/reactivity";
import { environmentThreadShells } from "./threads";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

const workspaceRefresh = Atom.family((key: string) => {
  const target = JSON.parse(key) as { environmentId: EnvironmentId; threadId?: ThreadId };
  return Atom.make((get) => {
    const refs = target.threadId
      ? [{ environmentId: target.environmentId, threadId: target.threadId }]
      : get(environmentThreadShells.environmentThreadRefsAtom(target.environmentId));
    return refs
      .map((ref) => {
        const run = get(environmentThreadShells.threadShellAtom(ref))?.latestRun;
        return `${ref.threadId}:${run?.runId}:${run?.status}:${run?.completedAt}`;
      })
      .join("|");
  });
});

export const threadWorkspaceGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "threadWorkspace:get",
  tag: WS_METHODS.threadWorkspaceGet,
  staleTimeMs: 5_000,
  refreshIntervalMs: 5_000,
  refreshTrigger: ({ environmentId, input }) =>
    workspaceRefresh(JSON.stringify({ environmentId, threadId: input.threadId })),
  idleTtlMs: 0,
});
export const threadWorkspacePatch = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "threadWorkspace:patch",
  tag: WS_METHODS.threadWorkspacePatch,
});
export const threadWorkspaceSaveDraft = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "threadWorkspace:saveDraft",
  tag: WS_METHODS.threadWorkspaceSaveDraft,
});
export const threadWorkspaceCounts = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "threadWorkspace:counts",
  tag: WS_METHODS.threadWorkspaceCounts,
  staleTimeMs: 5_000,
  refreshIntervalMs: 5_000,
  idleTtlMs: 0,
});

export const threadWorkspaceListWork = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "threadWorkspace:listWork",
  tag: WS_METHODS.threadWorkspaceListWork,
  staleTimeMs: 10_000,
  refreshIntervalMs: 10_000,
  refreshTrigger: ({ environmentId }) => workspaceRefresh(JSON.stringify({ environmentId })),
  idleTtlMs: 0,
});
