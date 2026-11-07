import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { type EnvironmentId, resolveEnvironmentMachineKind } from "@t3tools/contracts";

import { updateClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { usePreferredEnvironmentId } from "~/state/preferredEnvironment";
import { resolveEnvironmentOptionLabel } from "../BranchToolbar.logic";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Badge } from "../ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const AUTOMATIC = "automatic";

interface MachineOption {
  readonly value: string;
  readonly label: string;
  readonly machine: ReturnType<typeof resolveEnvironmentMachineKind> | null;
  readonly status: string | null;
}

function MachineOptionLabel({ option }: { readonly option: MachineOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {option.machine ? (
        <EnvironmentMachineIcon kind={option.machine} className="size-4 shrink-0 opacity-80" />
      ) : null}
      <span className="min-w-0 truncate">{option.label}</span>
      {option.status ? (
        <Badge variant="outline" size="sm">
          {option.status}
        </Badge>
      ) : null}
    </span>
  );
}

/** Which machine new work goes to when nothing on screen names one. Stored per device. */
export function PreferredEnvironmentSetting() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const preferredEnvironmentId = usePreferredEnvironmentId();
  const hydrated = useClientSettingsHydrated();

  if (environments.length < 2 && preferredEnvironmentId === null) return null;

  const machineOptions: MachineOption[] = environments.map((environment) => ({
    value: environment.environmentId,
    label: resolveEnvironmentOptionLabel({
      isPrimary: environment.environmentId === primaryEnvironmentId,
      environmentId: environment.environmentId,
      runtimeLabel: environment.label,
    }),
    machine: resolveEnvironmentMachineKind(environment.serverConfig),
    status:
      environment.connection.phase === "connected"
        ? null
        : connectionStatusText(environment.connection),
  }));
  const isStale =
    preferredEnvironmentId !== null &&
    !machineOptions.some((option) => option.value === preferredEnvironmentId);
  const options: MachineOption[] = [
    { value: AUTOMATIC, label: "Automatic", machine: null, status: null },
    ...machineOptions,
    ...(isStale
      ? [
          {
            value: preferredEnvironmentId,
            label: "Removed machine",
            machine: null,
            status: null,
          },
        ]
      : []),
  ];
  const value = preferredEnvironmentId ?? AUTOMATIC;
  const { id, title } = searchableSetting("preferred-environment");

  return (
    <SettingsSection id={id} title={title}>
      <SettingsRow
        title="Machine for new work"
        description={
          isStale
            ? "The preferred machine was removed, so new work uses the automatic choice. Pick another machine."
            : "New threads, threads without a project, and new projects start here unless you pick a machine. Automatic uses this app's own server first. Applies only to this device."
        }
        control={
          <Select
            value={value}
            disabled={!hydrated}
            onValueChange={(next) => {
              if (next === null) return;
              void updateClientSettings({
                preferredEnvironmentId: next === AUTOMATIC ? null : (next as EnvironmentId),
              });
            }}
          >
            <SelectTrigger size="xs" className="w-56" aria-label="Machine for new work">
              <SelectValue>
                {(selected: string | null) => {
                  const option = options.find((candidate) => candidate.value === selected);
                  return option ? <MachineOptionLabel option={option} /> : null;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <MachineOptionLabel option={option} />
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
