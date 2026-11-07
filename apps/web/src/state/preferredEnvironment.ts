import { preferredOrFallbackEnvironmentId } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { usePrimaryEnvironmentId, useEnvironments } from "./environments";

export function usePreferredEnvironmentId(): EnvironmentId | null {
  return useClientSettings((settings) => settings.preferredEnvironmentId);
}

export function readPreferredEnvironmentId(): EnvironmentId | null {
  return getClientSettings().preferredEnvironmentId;
}

/** The machine per-machine detail views open on: the known preferred machine, else the primary. */
export function useDefaultEnvironmentId(): EnvironmentId | null {
  const preferred = usePreferredEnvironmentId();
  const primary = usePrimaryEnvironmentId();
  const { presentationById } = useEnvironments();
  return preferredOrFallbackEnvironmentId(preferred, (id) => presentationById.has(id), primary);
}
