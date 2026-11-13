import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const hooks = vi.hoisted(() => ({
  useEnvironments: vi.fn(),
  usePrimaryEnvironmentId: vi.fn(),
}));
vi.mock("../../state/environments", () => hooks);

import { useAccessEnvironment } from "./useAccessEnvironment";

it("offers the secondary WSL backend for access management without a deep link", () => {
  const windows = {
    environmentId: EnvironmentId.make("windows"),
    label: "Windows",
    displayUrl: "http://127.0.0.1:3773",
    entry: { enabled: true, target: { _tag: "PrimaryConnectionTarget" } },
    connection: { phase: "connected" },
  };
  const wsl = {
    environmentId: EnvironmentId.make("wsl"),
    label: "WSL (Ubuntu)",
    displayUrl: "http://127.0.0.1:3774",
    entry: {
      enabled: true,
      target: { _tag: "BearerConnectionTarget", connectionId: "local:wsl:Ubuntu" },
    },
    connection: { phase: "connected" },
  };
  const disabled = {
    ...wsl,
    environmentId: EnvironmentId.make("disabled"),
    entry: { ...wsl.entry, enabled: false },
  };
  hooks.useEnvironments.mockReturnValue({ environments: [windows, wsl, disabled] });
  hooks.usePrimaryEnvironmentId.mockReturnValue(windows.environmentId);

  expect(useAccessEnvironment(null).candidates).toEqual([windows, wsl]);
  expect(useAccessEnvironment(wsl.environmentId).environment).toEqual(wsl);
  expect(useAccessEnvironment(disabled.environmentId).environment).toEqual(disabled);
});
