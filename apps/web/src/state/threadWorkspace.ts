import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadWorkspaceGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "threadWorkspace:get",
  tag: WS_METHODS.threadWorkspaceGet,
  staleTimeMs: 5_000,
  refreshIntervalMs: 5_000,
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
  idleTtlMs: 0,
});
