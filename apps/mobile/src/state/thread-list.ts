import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const threadListAtom = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:thread-list",
  tag: WS_METHODS.threadListRead,
});
export const threadArtifactsAtom = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:thread-artifacts",
  tag: WS_METHODS.threadArtifactList,
});
export const threadArtifactAtom = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:thread-artifact",
  tag: WS_METHODS.threadArtifactRead,
});
