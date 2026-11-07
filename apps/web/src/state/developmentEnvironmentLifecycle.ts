import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const developmentEnvironmentAppCommands = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "development-environments:app-commands",
    tag: WS_METHODS.developmentEnvironmentsListAppCommands,
    staleTimeMs: 60_000,
    idleTtlMs: 60_000,
  },
);

export const developmentEnvironmentAppLogs = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "development-environments:app-logs",
    tag: WS_METHODS.developmentEnvironmentsReadAppLogs,
    staleTimeMs: 2_000,
    idleTtlMs: 15_000,
  },
);

export const developmentEnvironmentCleanupAssessment = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "development-environments:assess-cleanup",
    tag: WS_METHODS.developmentEnvironmentsAssessCleanup,
    // Cleanup must confirm a fresh assessment; never reuse an old one.
    staleTimeMs: 0,
    idleTtlMs: 5_000,
  },
);

export const createDevelopmentEnvironment = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "development-environments:create",
  tag: WS_METHODS.developmentEnvironmentsCreate,
});

export const attachDevelopmentEnvironment = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "development-environments:attach",
  tag: WS_METHODS.developmentEnvironmentsAttach,
});

export const repairDevelopmentEnvironment = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "development-environments:repair",
  tag: WS_METHODS.developmentEnvironmentsRepair,
});

export const startDevelopmentEnvironmentApp = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "development-environments:start-app",
  tag: WS_METHODS.developmentEnvironmentsStartApp,
});

export const stopDevelopmentEnvironmentApp = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "development-environments:stop-app",
  tag: WS_METHODS.developmentEnvironmentsStopApp,
});

export const cleanUpDevelopmentEnvironment = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "development-environments:clean-up",
  tag: WS_METHODS.developmentEnvironmentsCleanUp,
});
