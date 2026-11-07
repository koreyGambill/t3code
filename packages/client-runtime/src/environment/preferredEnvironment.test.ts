import { describe, expect, it } from "vite-plus/test";

import { chooseWorkEnvironment } from "./preferredEnvironment.ts";

describe("chooseWorkEnvironment", () => {
  const known = new Set(["windows", "wsl"]);
  const choose = (input: {
    preferred: string | null;
    usable?: ReadonlyArray<string>;
    fallback?: string | null;
  }) =>
    chooseWorkEnvironment({
      preferred: input.preferred,
      isKnown: (id) => known.has(id),
      isUsable: (id) => (input.usable ?? ["windows", "wsl"]).includes(id),
      fallback: () => (input.fallback === undefined ? "windows" : input.fallback),
    });

  it("keeps the previous default when no machine is preferred", () => {
    expect(choose({ preferred: null })).toEqual({ kind: "chosen", environmentId: "windows" });
    expect(choose({ preferred: null, fallback: null })).toEqual({ kind: "none" });
  });

  it("uses the preferred machine over the fallback", () => {
    expect(choose({ preferred: "wsl" })).toEqual({ kind: "chosen", environmentId: "wsl" });
  });

  it("reports an unusable preferred machine instead of falling back", () => {
    expect(choose({ preferred: "wsl", usable: ["windows"] })).toEqual({
      kind: "preferred-unavailable",
      environmentId: "wsl",
    });
  });

  it("ignores a preference for a machine the client no longer knows", () => {
    expect(choose({ preferred: "removed" })).toEqual({ kind: "chosen", environmentId: "windows" });
  });
});
