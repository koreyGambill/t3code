import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

const queryOptions = { staleTimeMs: 2_000, idleTtlMs: 0 };
export const threadWorkspaceGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "workspace:get",
  tag: WS_METHODS.threadWorkspaceGet,
  ...queryOptions,
});
export const threadListRead = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "list:read",
  tag: WS_METHODS.threadListRead,
  refreshIntervalMs: 5_000,
  ...queryOptions,
});
export const threadListUpdate = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "list:update",
  tag: WS_METHODS.threadListUpdate,
});
export const threadArtifactList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "artifact:list",
  tag: WS_METHODS.threadArtifactList,
  refreshIntervalMs: 5_000,
  ...queryOptions,
});
export const threadArtifactAnswer = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "artifact:answer",
  tag: WS_METHODS.threadArtifactAnswer,
});
