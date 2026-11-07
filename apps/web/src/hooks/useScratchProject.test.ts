import type { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createScratchProjectActions } from "./useScratchProject";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;
const other = "other" as EnvironmentId;

function scratchEnvironment(environmentId: EnvironmentId, scratchWorkspaceRoot: string | null) {
  return {
    environmentId,
    connection: { phase: "connected" },
    serverConfig: { scratchWorkspaceRoot },
  } as never;
}

function actions(
  primary: EnvironmentId | null,
  localRoot: string | null,
  remoteRoot: string | null = "/remote/scratch",
  preferred: EnvironmentId | null = null,
) {
  const environments = [
    scratchEnvironment(local, localRoot),
    scratchEnvironment(remote, remoteRoot),
    scratchEnvironment(other, "/other/scratch"),
  ];
  return createScratchProjectActions({
    environments: () => environments,
    primaryEnvironmentId: () => primary,
    preferredEnvironmentId: () => preferred,
    registry: AtomRegistry.make(),
    handleNewThread: async () => null,
  });
}

describe("scratchEnvironmentId", () => {
  it("prefers the primary environment over the one on screen", () => {
    expect(actions(local, "/local/scratch").scratchEnvironmentId(remote)).toBe(local);
    expect(actions(local, "/local/scratch").scratchEnvironmentId(null)).toBe(local);
  });

  it("falls back when the primary environment offers no scratch root", () => {
    expect(actions(local, null).scratchEnvironmentId(remote)).toBe(remote);
    expect(actions(null, null).scratchEnvironmentId(remote)).toBe(remote);
    expect(actions(null, null, null).scratchEnvironmentId(remote)).toBe(other);
    expect(actions(local, null).scratchEnvironmentId(null)).toBeNull();
  });

  it("uses the preferred machine over the primary and the one on screen", () => {
    expect(
      actions(local, "/local/scratch", "/remote/scratch", remote).scratchEnvironmentId(other),
    ).toBe(remote);
  });

  it("does not fall back to the primary when the preferred machine has no scratch root", () => {
    const scratch = actions(local, "/local/scratch", null, remote);
    expect(scratch.scratchEnvironmentChoice(local)).toEqual({
      kind: "preferred-unavailable",
      environmentId: remote,
    });
    expect(scratch.scratchEnvironmentId(local)).toBeNull();
  });

  it("ignores a preferred machine that is no longer saved", () => {
    expect(
      actions(
        local,
        "/local/scratch",
        "/remote/scratch",
        "removed" as EnvironmentId,
      ).scratchEnvironmentId(remote),
    ).toBe(local);
  });
});
