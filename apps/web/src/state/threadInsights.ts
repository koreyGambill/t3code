import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const threadInsightsGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "threadInsights:get",
  tag: WS_METHODS.threadInsightsGet,
  staleTimeMs: 0,
  idleTtlMs: 0,
});

export const threadContextGet = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "threadInsights:context",
  tag: WS_METHODS.threadContextGet,
  staleTimeMs: 30_000,
  idleTtlMs: 0,
});
