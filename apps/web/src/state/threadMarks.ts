import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const threadMarksGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "threadMarks:get",
  tag: WS_METHODS.threadMarksGet,
  staleTimeMs: 0,
  idleTtlMs: 0,
});
