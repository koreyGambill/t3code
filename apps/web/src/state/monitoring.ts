import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const monitoringStatus = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "monitoring:status",
  tag: WS_METHODS.monitoringStatus,
  staleTimeMs: 30_000,
  refreshIntervalMs: 30_000,
  idleTtlMs: 0,
});

export const monitoringList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "monitoring:list",
  tag: WS_METHODS.monitoringList,
  staleTimeMs: 15_000,
  idleTtlMs: 0,
});
export const monitoringUpsert = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "monitoring:upsert",
  tag: WS_METHODS.monitoringUpsert,
});
export const monitoringSetEnabled = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "monitoring:setEnabled",
  tag: WS_METHODS.monitoringSetEnabled,
});
export const monitoringRunNow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "monitoring:runNow",
  tag: WS_METHODS.monitoringRunNow,
});
export const monitoringSetDisposition = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "monitoring:setDisposition",
  tag: WS_METHODS.monitoringSetDisposition,
});
