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
