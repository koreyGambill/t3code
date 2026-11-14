import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  type InstructionFootprint,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as McpAppModelContext from "../mcpApps/McpAppModelContext.ts";
import * as McpToolCatalog from "../mcp/McpToolCatalog.ts";
import { buildCodexTurnStartParams } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import {
  claudePreparedContextEntries,
  makeClaudeQueryOptions,
} from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { ProviderInstanceRegistry } from "../provider/ProviderInstanceRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { DefaultContext, layer as defaultContextLayer } from "./DefaultContext.ts";
import { t3ContextParts } from "./defaultContextParts.ts";
import { InstructionFootprints } from "./InstructionFootprints.ts";
import {
  FILE_CONVENTIONS,
  fileStatus,
  importReferences,
  reconcileFiles,
  resolveInstructionFiles,
} from "./instructionFiles.ts";

const parts = (driver: string, deviceTools: boolean, hasT3Mcp = true) =>
  t3ContextParts({
    driver,
    model: "gpt-5.4",
    interactionMode: "default",
    hasT3Mcp,
    browserTools: true,
    deviceTools,
  });

it("renders Claude's append with the adapter's own query options", () => {
  for (const deviceTools of [false, true]) {
    for (const hasT3Mcp of [false, true]) {
      const { systemPrompt } = makeClaudeQueryOptions({
        modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
        nativeThreadId: "preview",
        resume: false,
        cwd: null,
        deviceToolsAvailable: deviceTools,
        ...(hasT3Mcp
          ? { mcpServers: { "t3-code": { type: "http", url: "http://127.0.0.1/mcp" } } }
          : {}),
      });
      const append =
        typeof systemPrompt === "object" && "append" in systemPrompt ? systemPrompt.append : "";
      expect(parts("claudeAgent", deviceTools, hasT3Mcp).groups[0]?.entries).toEqual(
        claudePreparedContextEntries(append ?? ""),
      );
    }
  }
});

it.effect("renders Codex additionalContext with the adapter's own turn parameters", () =>
  Effect.gen(function* () {
    for (const deviceTools of [false, true]) {
      const params = yield* buildCodexTurnStartParams({
        nativeThreadId: "preview",
        codexInput: [{ type: "text", text: "hi" }],
        runtimePolicy: { runtimeMode: "full-access", interactionMode: "default", cwd: null },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        hasT3Mcp: true,
        browserToolsAvailable: true,
        deviceToolsAvailable: deviceTools,
      });
      expect(parts("codex", deviceTools).groups[0]?.entries).toEqual(
        Object.entries(params.additionalContext ?? {}).map(([key, entry]) => ({
          key,
          text: entry.value,
        })),
      );
    }
  }),
);

it("marks drivers without a known injection path unsupported", () => {
  expect(parts("ollama", false)).toEqual({ support: "unsupported", groups: [] });
  expect(parts("kiro", false).groups[0]?.delivery).toBe("first-prompt");
});

it("finds @ imports outside code and ignores fenced or inline ones", () => {
  expect(
    importReferences(
      "See @./a.md and @~/b.md.\nmail korey@example.com\n`@skip.md`\n```\n@fenced.md\n```\n@docs/c.md @/abs.md @...",
    ),
  ).toEqual(["./a.md", "~/b.md", "docs/c.md", "/abs.md"]);
});

const write = (fs: FileSystem.FileSystem, file: string, text: string) =>
  fs
    .makeDirectory(file.slice(0, file.lastIndexOf("/")), { recursive: true })
    .pipe(Effect.andThen(fs.writeFileString(file, text)));

it.effect("resolves Claude's hierarchy, rules and imports inside the allowed roots", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "default-ctx-" }));
    const home = path.join(base, "home");
    const outside = path.join(base, "outside");
    const repo = path.join(home, "code", "repo");
    const cwd = path.join(repo, "pkg");
    yield* write(fs, path.join(home, ".claude", "CLAUDE.md"), "@~/.config/one.md");
    yield* write(fs, path.join(home, ".config", "one.md"), "@two.md");
    yield* write(fs, path.join(home, ".config", "two.md"), "@three.md");
    yield* write(fs, path.join(home, ".config", "three.md"), "@four.md");
    yield* write(fs, path.join(home, ".config", "four.md"), "@five.md");
    yield* write(fs, path.join(home, ".config", "five.md"), "@six.md @one.md");
    yield* write(fs, path.join(home, ".config", "six.md"), "too deep");
    yield* write(fs, path.join(home, "code", "CLAUDE.md"), "ancestor");
    yield* write(fs, path.join(repo, ".git", "HEAD"), "ref");
    yield* write(
      fs,
      path.join(repo, "CLAUDE.md"),
      `@.env @${outside}/x.md\n\`\`\`\n@./skipped.md\n\`\`\``,
    );
    yield* write(fs, path.join(repo, ".env"), "SECRET=1");
    yield* write(fs, path.join(repo, "skipped.md"), "fenced");
    yield* write(fs, path.join(outside, "x.md"), "outside");
    yield* write(fs, path.join(cwd, ".claude", "CLAUDE.md"), "nested");
    yield* write(fs, path.join(cwd, "CLAUDE.local.md"), "local");
    yield* write(fs, path.join(cwd, ".claude", "rules", "always.md"), "# always");
    yield* write(fs, path.join(cwd, ".claude", "rules", "scoped.md"), "---\npaths: src/**\n---\n");
    yield* fs.symlink(path.join(outside, "x.md"), path.join(cwd, "CLAUDE.md"));

    const { files } = yield* resolveInstructionFiles(FILE_CONVENTIONS.claudeAgent!, cwd, {
      home,
      platform: "linux",
      env: {},
    });
    expect(
      files.map((file) => [path.relative(base, file.path), file.scope, file.depth, file.status]),
    ).toEqual([
      ["home/.claude/CLAUDE.md", "global", 0, "expected"],
      ["home/.config/one.md", "import", 1, "expected"],
      ["home/.config/two.md", "import", 2, "expected"],
      ["home/.config/three.md", "import", 3, "expected"],
      ["home/.config/four.md", "import", 4, "expected"],
      ["home/.config/five.md", "import", 5, "expected"],
      ["home/code/CLAUDE.md", "project", 0, "expected"],
      ["home/code/repo/CLAUDE.md", "project", 0, "expected"],
      ["home/code/repo/.env", "import", 1, "secret"],
      ["outside/x.md", "import", 1, "outside-home"],
      ["home/code/repo/pkg/.claude/CLAUDE.md", "project", 0, "expected"],
      ["home/code/repo/pkg/CLAUDE.local.md", "project", 0, "expected"],
      ["home/code/repo/pkg/.claude/rules/always.md", "rule", 0, "expected"],
    ]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("walks Codex's chain from the git root and reconciles reported sources", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "default-ctx-" }));
    const repo = path.join(home, "repo");
    const cwd = path.join(repo, "app");
    yield* write(fs, path.join(home, "codex", "AGENTS.md"), "global");
    yield* write(fs, path.join(home, "AGENTS.md"), "above the git root");
    yield* write(fs, path.join(repo, ".git"), "gitdir: elsewhere");
    yield* write(fs, path.join(repo, "AGENTS.md"), "root");
    yield* write(fs, path.join(cwd, "AGENTS.md"), "plain");
    yield* write(fs, path.join(cwd, "AGENTS.override.md"), "override");

    const { files } = yield* resolveInstructionFiles(FILE_CONVENTIONS.codex!, cwd, {
      home,
      platform: "linux",
      env: { CODEX_HOME: path.join(home, "codex") },
    });
    expect(files.map((file) => path.relative(home, file.path))).toEqual([
      "codex/AGENTS.md",
      "repo/AGENTS.md",
      "repo/app/AGENTS.override.md",
    ]);
    const rows = reconcileFiles(files, [
      { path: path.join(home, "codex", "AGENTS.md"), bytes: 6 },
      { path: path.join(cwd, "AGENTS.override.md"), bytes: 8 },
      { path: "/elsewhere/AGENTS.md", bytes: 3 },
    ]);
    expect(rows.map((row) => [path.relative(home, row.path), fileStatus(row)])).toEqual([
      ["codex/AGENTS.md", "loaded"],
      ["repo/AGENTS.md", "not-loaded"],
      ["repo/app/AGENTS.override.md", "loaded"],
      [path.relative(home, "/elsewhere/AGENTS.md"), "unexpected"],
    ]);
    expect(reconcileFiles(files, undefined).map(fileStatus)).toEqual([
      "expected",
      "expected",
      "expected",
    ]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

const threadId = ThreadId.make("thread-default-context");
const runId = RunId.make("run-1");

const serviceLayer = (home: string, footprint: InstructionFootprint | undefined) =>
  defaultContextLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadRecords: (_threadId, fields) =>
            Effect.succeed({
              thread: {
                deletedAt: null,
                providerInstanceId: ProviderInstanceId.make("codex"),
                modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
                projectId: ProjectId.make("project"),
                worktreePath: home,
                interactionMode: "default",
              },
              runs: fields.includes("runs" as never) ? [{ id: runId, ordinal: 1 }] : [],
              messages: [{ text: "<child_preamble>Use the scratch DB.</child_preamble>\nTask" }],
            } as never),
        }),
        Layer.mock(InstructionFootprints)({
          list: () => Effect.succeed(footprint === undefined ? [] : [footprint]),
        }),
        Layer.mock(McpAppModelContext.McpAppModelContext)({
          forThread: () => Effect.succeed([]),
        }),
        Layer.mock(ProjectService)({ getById: () => Effect.succeedNone }),
        Layer.mock(ProviderInstanceRegistry)({
          getInstance: () => Effect.succeed({ driverKind: "codex" } as never),
        }),
        Layer.mock(ServerSettingsService)({
          getSettings: Effect.succeed({ providerInstances: {} } as never),
        }),
        Layer.mock(McpProviderSessions)({ read: () => Effect.undefined }),
        Layer.succeed(
          McpToolCatalog.McpToolCatalog,
          McpToolCatalog.McpToolCatalog.of({
            attach: () => Effect.void,
            list: Effect.succeed([
              { name: "delegate_task", description: "Start a child.", inputSchema: {} },
            ]),
          }),
        ),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );

it.effect("serves item text only for ids in the resolved preview and flags changed parts", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "default-ctx-" }));
    yield* write(fs, path.join(home, ".git", "HEAD"), "ref");
    yield* write(fs, path.join(home, "AGENTS.md"), "project rules");
    yield* write(fs, path.join(home, ".env"), "SECRET=1");
    const footprint: InstructionFootprint = {
      threadId,
      runId,
      providerInstanceId: ProviderInstanceId.make("codex"),
      driver: "codex",
      model: "gpt-5.4",
      capturedAt: DateTime.formatIso(DateTime.makeUnsafe(0)),
      source: "test",
      parts: [
        {
          key: "t3:runtime",
          label: "Runtime identity and output",
          category: "t3",
          bytes: 1,
          estimatedTokens: 1,
        },
        {
          key: "custom_x",
          label: "Custom prompt append",
          category: "custom",
          bytes: 40,
          estimatedTokens: 10,
        },
      ],
      instructionSources: [{ path: path.join(home, "AGENTS.md"), bytes: 13 }],
    };
    const context = yield* Layer.build(serviceLayer(home, footprint)).pipe(
      Effect.provideService(HostProcess.HomeDirectory, home),
      Effect.provideService(HostProcess.Environment, { CODEX_HOME: path.join(home, "codex") }),
    );
    const service = Context.get(context, DefaultContext);
    const preview = yield* service.preview({ threadId });
    const byId = new Map(preview.items.map((item) => [item.id, item]));
    expect(preview.support).toBe("exact");
    expect(byId.get(`file:${path.join(home, "AGENTS.md")}`)?.status).toBe("loaded");
    expect(
      [...byId.values()].find((item) => item.label === "Runtime identity and output")?.status,
    ).toBe("changed");
    expect(byId.get("last:custom:custom_x:Custom prompt append")).toMatchObject({
      status: "last-turn-only",
      counted: false,
      readable: false,
    });
    expect(byId.get("preamble:0")?.bytes).toBe(19);
    expect(byId.get("tool:delegate_task")?.counted).toBe(true);

    const file = yield* service.itemText({
      threadId,
      itemId: `file:${path.join(home, "AGENTS.md")}`,
    });
    expect(file.text).toBe("project rules");
    const refused = yield* Effect.flip(
      service.itemText({ threadId, itemId: `file:${path.join(home, ".env")}` }),
    );
    expect(refused.message).toBe("This item has no readable text.");
  }).pipe(Effect.provide(NodeServices.layer)),
);
