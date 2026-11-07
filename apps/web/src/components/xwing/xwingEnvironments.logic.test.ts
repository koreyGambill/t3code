import {
  type DevelopmentEnvironmentCheckoutChoice,
  XwingEnvironmentId,
  type XwingEnvironmentSummary,
  type XwingRepositorySummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { filterXwingCheckoutChoices, filterXwingEnvironments } from "./xwingEnvironments.logic";

const environment = (
  id: string,
  fields: Pick<XwingEnvironmentSummary, "name" | "repositories"> & Partial<XwingEnvironmentSummary>,
): XwingEnvironmentSummary => ({
  id: XwingEnvironmentId.make(id),
  status: "active",
  rootPath: `/x/${id}`,
  createdAt: "2026-11-07T17:58:05Z",
  updatedAt: "2026-11-07T17:58:05Z",
  ...fields,
});

const repository = (
  fields: Pick<XwingRepositorySummary, "path" | "branch"> & Partial<XwingRepositorySummary>,
): XwingRepositorySummary => ({
  name: "t3code",
  sourcePath: "/home/dev/code/t3code",
  present: true,
  ...fields,
});

const environments = [
  environment("a9372dfe2f232044", {
    number: 1100,
    name: "loads-panel-testing",
    repositories: [
      repository({ path: "/x/envs/1100/t3code", branch: "loads" }),
      repository({
        name: "xwing",
        sourcePath: "/home/dev/code/xwing",
        path: "/x/envs/1100/xwing",
        branch: "consumers",
      }),
    ],
  }),
  environment("56460e7eab92c116", {
    number: 1099,
    name: "t3-wsl-experience",
    ticket: "BW-3104",
    repositories: [
      repository({
        path: "/x/envs/1099/t3code",
        branch: "wsl",
        present: false,
      }),
    ],
  }),
  environment("c6f0e96cdb07b413", {
    number: 1001,
    name: "shipped",
    status: "archived",
    archivedAt: "2026-11-07T17:58:06Z",
    repositories: [
      repository({
        path: "/x/archives/c6f0/t3code",
        branch: "old",
        present: false,
      }),
    ],
  }),
  environment("d1d1d1d1d1d1d1d1", {
    number: 1002,
    name: "other t3code",
    repositories: [
      repository({
        sourcePath: "/home/dev/forks/t3code",
        path: "/x/envs/1002/t3code",
        branch: "fork",
      }),
    ],
  }),
  environment("e2e2e2e2e2e2e2e2", {
    number: 1003,
    name: "fresh",
    repositories: [],
  }),
];

describe("filterXwingCheckoutChoices", () => {
  it("searches the server's choices by number, name, ticket, repository and branch", () => {
    const choice = (
      id: string,
      fields: Partial<DevelopmentEnvironmentCheckoutChoice>,
    ): DevelopmentEnvironmentCheckoutChoice => ({
      xwingEnvironmentId: XwingEnvironmentId.make(id),
      name: "env",
      repositoryName: "t3code",
      branch: "main",
      checkoutPath: `/x/envs/${id}/t3code`,
      ...fields,
    });
    const choices = [
      choice("a9372dfe", { number: 1100, name: "loads-panel-testing", branch: "loads" }),
      choice("56460e7e", { number: 1099, name: "t3-wsl", ticket: "BW-3104", branch: "wsl" }),
    ];
    const ids = (query: string) =>
      filterXwingCheckoutChoices(choices, query).map((entry) => entry.xwingEnvironmentId);

    expect(ids("#1100")).toEqual(["a9372dfe"]);
    expect(ids("LOADS-panel loads")).toEqual(["a9372dfe"]);
    expect(ids("bw-3104 wsl")).toEqual(["56460e7e"]);
    expect(ids("consumers")).toEqual([]);
    expect(ids("  ")).toHaveLength(2);
  });
});

describe("filterXwingEnvironments", () => {
  it("lists active environments, empty ones included, before archived ones", () => {
    const ids = (query: string) =>
      filterXwingEnvironments(environments, query).map((environment) => environment.name);

    expect(ids("")).toEqual([
      "loads-panel-testing",
      "t3-wsl-experience",
      "other t3code",
      "fresh",
      "shipped",
    ]);
    expect(ids("archived")).toEqual(["shipped"]);
    expect(ids("bw-3104 wsl")).toEqual(["t3-wsl-experience"]);
  });
});
