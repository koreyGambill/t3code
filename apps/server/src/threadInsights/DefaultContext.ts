import {
  type DefaultContextGetInput,
  type DefaultContextItem,
  type DefaultContextItemInput,
  type DefaultContextItemText,
  type DefaultContextPreview,
  type InstructionFootprint,
  ThreadInsightsError,
} from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as McpAppModelContext from "../mcpApps/McpAppModelContext.ts";
import * as McpToolCatalog from "../mcp/McpToolCatalog.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { SCRATCH_FOLDER_CONTEXT } from "../orchestration-v2/ProviderTurnStartService.ts";
import { ManagedProjectFolders } from "../project/ManagedProjectFolders.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { codexDefaultReasoningEffortOverride } from "../provider/CodexProvider.ts";
import { ProviderInstanceRegistry } from "../provider/ProviderInstanceRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { NOT_VISIBLE, t3ContextParts, toolExposure } from "./defaultContextParts.ts";
import {
  childPreambleEntries,
  InstructionFootprints,
  splitPreparedContext,
} from "./InstructionFootprints.ts";
import {
  FILE_CONVENTIONS,
  fileStatus,
  MAX_READ_BYTES,
  reconcileFiles,
  resolveInstructionFiles,
} from "./instructionFiles.ts";

export class DefaultContext extends Context.Service<
  DefaultContext,
  {
    readonly preview: (
      input: DefaultContextGetInput,
    ) => Effect.Effect<DefaultContextPreview, ThreadInsightsError>;
    readonly itemText: (
      input: DefaultContextItemInput,
    ) => Effect.Effect<DefaultContextItemText, ThreadInsightsError>;
  }
>()("t3/threadInsights/DefaultContext") {}

const DIRECT_TOOLS = new Set(["orchestrator_capabilities", "delegate_task", "task_status"]);
const tokens = (bytes: number) => Math.ceil(bytes / 4);
const byteLength = (text: string) => Buffer.byteLength(text, "utf8");
const failure = (message: string) => (cause: unknown) =>
  new ThreadInsightsError({ message, cause });

type Loader = Effect.Effect<string>;
// Advertised schemas are plain JSON the MCP server already serialized for tools/list.
const schemaText = (schema: unknown) => JSON.stringify(schema ?? {}, null, 2);

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const footprints = yield* InstructionFootprints;
  const appContext = yield* McpAppModelContext.McpAppModelContext;
  const folders = yield* Effect.serviceOption(ManagedProjectFolders);
  const projects = yield* ProjectService;
  const instances = yield* ProviderInstanceRegistry;
  const settings = yield* ServerSettingsService;
  const mcpSessions = yield* McpProviderSessions;
  const catalog = yield* McpToolCatalog.McpToolCatalog;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const resolve = Effect.fn("DefaultContext.resolve")(function* (input: DefaultContextGetInput) {
    const records = yield* orchestrator
      .getThreadRecords(input.threadId, ["runs"])
      .pipe(Effect.mapError(failure("Could not load the thread.")));
    const thread = records.thread;
    if (thread.deletedAt !== null)
      return yield* new ThreadInsightsError({ message: "This thread was deleted." });
    const instanceId = input.providerInstanceId ?? thread.providerInstanceId;
    const sameInstance = instanceId === thread.providerInstanceId;
    const model = input.model ?? (sameInstance ? thread.modelSelection.model : "");
    const instance = yield* instances.getInstance(instanceId);
    const driver = instance?.driverKind ?? "";
    const project = yield* projects
      .getById(thread.projectId, { includeDeleted: true })
      .pipe(Effect.orElseSucceed(() => Option.none()));
    const cwd = thread.worktreePath ?? Option.getOrUndefined(project)?.workspaceRoot ?? null;

    const items: DefaultContextItem[] = [];
    const loaders = new Map<string, Loader>();
    const notes: string[] = [];
    const push = (item: DefaultContextItem, load?: Loader) => {
      items.push(item);
      if (load !== undefined) loaders.set(item.id, load);
    };

    const runs = records.runs.toSorted((a, b) => a.ordinal - b.ordinal);
    const lastFootprint: InstructionFootprint | undefined =
      runs.length === 0
        ? undefined
        : (yield* footprints
            .list(input.threadId, runs.at(-1)!.id)
            .pipe(Effect.orElseSucceed(() => []))).at(-1);
    const footprint = lastFootprint?.driver === driver ? lastFootprint : undefined;

    const session = yield* mcpSessions.read(input.threadId);
    if (session === undefined)
      notes.push(
        "No live session: assumes T3 tools attach with browser tools and no device tools.",
      );
    const effort = sameInstance
      ? getModelSelectionStringOptionValue(thread.modelSelection, "reasoningEffort")
      : undefined;
    const t3 = t3ContextParts({
      driver,
      model,
      reasoningEffort:
        driver === "codex" ? (effort ?? codexDefaultReasoningEffortOverride(model)) : effort,
      interactionMode: thread.interactionMode,
      hasT3Mcp: true,
      browserTools: session?.browserToolsAvailable ?? true,
      deviceTools: session?.capabilities?.has("device") ?? false,
    });
    const lastParts = new Map(
      (footprint?.parts ?? []).map((part) => [`${part.category}:${part.key}:${part.label}`, part]),
    );
    const seenParts = new Set<string>();
    const addParts = (
      group: { delivery: DefaultContextItem["delivery"]; source: string },
      entries: ReadonlyArray<{ key: string; text: string }>,
      idPrefix: string,
    ) => {
      for (const part of splitPreparedContext(entries)) {
        const identity = `${part.category}:${part.key}:${part.label}`;
        seenParts.add(identity);
        const last = lastParts.get(identity);
        push(
          {
            id: `${idPrefix}:${identity}`,
            category: part.category,
            label: part.label,
            source: group.source,
            delivery: group.delivery,
            bytes: part.bytes,
            estimatedTokens: part.estimatedTokens,
            counted: true,
            readable: true,
            ...(footprint === undefined
              ? {}
              : { status: last === undefined || last.bytes !== part.bytes ? "changed" : "loaded" }),
          },
          Effect.succeed(part.text),
        );
      }
    };
    for (const [index, group] of t3.groups.entries()) addParts(group, group.entries, `t3${index}`);

    const apps = (yield* appContext
      .forThread(input.threadId)
      .pipe(Effect.orElseSucceed(() => []))).map((entry) => ({
      key: `mcp_app_${entry.itemId.replace(/[^\w.-]/g, "_")}`,
      text: entry.text,
    }));
    const scratch =
      Option.isSome(folders) && (yield* folders.value.isScratchProject(thread.projectId, cwd));
    addParts(
      { delivery: "every-turn", source: "App context T3 adds to each turn" },
      [...apps, ...(scratch ? [SCRATCH_FOLDER_CONTEXT] : [])],
      "app",
    );
    for (const part of footprint?.parts ?? []) {
      const identity = `${part.category}:${part.key}:${part.label}`;
      if (seenParts.has(identity)) continue;
      push({
        id: `last:${identity}`,
        category: part.category,
        label: part.label,
        source: "Sent last turn; not predicted for the next one",
        delivery: "every-turn",
        bytes: part.bytes,
        estimatedTokens: part.estimatedTokens,
        counted: false,
        readable: false,
        status: "last-turn-only",
      });
    }

    if (runs.length > 0) {
      const first = yield* orchestrator
        .getThreadRecords(input.threadId, ["messages"], {
          messageRunIds: [runs[0]!.id],
          messageRoles: ["user"],
        })
        .pipe(Effect.orElseSucceed(() => ({ messages: [] })));
      for (const [index, entry] of childPreambleEntries(first.messages[0]?.text ?? "").entries()) {
        const bytes = byteLength(entry.text);
        push(
          {
            id: `preamble:${index}`,
            category: "app-context",
            label: "Child preamble",
            source: "First message from the parent thread",
            delivery: "first-message",
            bytes,
            estimatedTokens: tokens(bytes),
            counted: true,
            readable: true,
          },
          Effect.succeed(entry.text),
        );
      }
    }

    const convention = FILE_CONVENTIONS[driver];
    if (convention !== undefined && cwd !== null) {
      const base = yield* HostProcess.Environment;
      const configured = (yield* settings.getSettings.pipe(Effect.option)).pipe(
        Option.flatMap((value) =>
          Option.fromNullishOr(value.providerInstances[instanceId]?.environment),
        ),
        Option.getOrUndefined,
      );
      const env = yield* mergeProviderInstanceEnvironment(configured, base);
      const resolved = yield* resolveInstructionFiles(convention, cwd, {
        home: yield* HostProcess.HomeDirectory,
        platform: yield* HostProcess.Platform,
        env,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      for (const file of reconcileFiles(resolved.files, footprint?.instructionSources)) {
        const status = fileStatus(file);
        const readable = file.status === "expected" && !file.unexpected;
        push(
          {
            id: `file:${file.path}`,
            category: "files",
            label: file.path,
            source:
              file.status === "outside-home"
                ? "Outside $HOME, not read"
                : file.status === "secret"
                  ? "Looks like a secret, not read"
                  : file.scope === "import"
                    ? "@ import"
                    : file.scope === "rule"
                      ? "Rule file"
                      : file.scope === "global"
                        ? "User or managed file"
                        : "Project file",
            delivery: "session-start",
            bytes: file.bytes,
            estimatedTokens: tokens(file.bytes),
            counted: file.status === "expected",
            readable,
            ...(file.depth > 0 ? { depth: file.depth } : {}),
            status,
          },
          readable ? fs.readFileString(file.path).pipe(Effect.orElseSucceed(() => "")) : undefined,
        );
      }
    }

    const exposure = toolExposure(driver);
    const tools = t3.support === "unsupported" ? [] : yield* catalog.list;
    if (t3.support !== "unsupported" && tools.length === 0)
      notes.push("The T3 tool list is not available yet.");
    if (exposure === "names" && tools.length > 0) {
      const names = tools.map((tool) => tool.name).join("\n");
      const bytes = byteLength(names);
      push(
        {
          id: "tools:names",
          category: "tools",
          label: `${tools.length} deferred tool names`,
          source: "Claude Code lists MCP tools by name and loads one through ToolSearch",
          delivery: "every-turn",
          bytes,
          estimatedTokens: tokens(bytes),
          counted: true,
          readable: true,
        },
        Effect.succeed(names),
      );
    }
    for (const tool of tools) {
      const schema = schemaText(tool.inputSchema);
      const text = `${tool.description}\n\n${schema}`;
      const bytes = byteLength(tool.name) + byteLength(tool.description) + byteLength(schema);
      const listed = exposure === "all" || (exposure === "direct" && DIRECT_TOOLS.has(tool.name));
      push(
        {
          id: `tool:${tool.name}`,
          category: "tools",
          label: tool.name,
          source: listed ? "Description and schema" : "Loads on demand through tool search",
          delivery: listed ? "every-turn" : "on-demand",
          bytes,
          estimatedTokens: tokens(bytes),
          counted: listed,
          readable: true,
        },
        Effect.succeed(text),
      );
    }

    if (instance === undefined) notes.push("This provider instance is not configured here.");
    return {
      preview: {
        threadId: input.threadId,
        providerInstanceId: instanceId,
        driver,
        model,
        cwd,
        support: t3.support,
        filesSupported: convention !== undefined,
        notes,
        items,
        notVisible: NOT_VISIBLE[driver] ?? [],
        lastTurn:
          lastFootprint === undefined
            ? null
            : {
                capturedAt: lastFootprint.capturedAt,
                model: lastFootprint.model,
                reportsFiles: footprint?.instructionSources !== undefined,
              },
        estimateMethod:
          "UTF-8 bytes divided by four, rounded up; not tokenizer counts. Instruction files are what the provider documents loading for this folder, not what it reported.",
      } satisfies DefaultContextPreview,
      loaders,
    };
  });

  return DefaultContext.of({
    preview: Effect.fn("DefaultContext.preview")(function* (input) {
      return (yield* resolve(input)).preview;
    }),
    itemText: Effect.fn("DefaultContext.itemText")(function* (input) {
      const { loaders } = yield* resolve(input);
      const load = loaders.get(input.itemId);
      if (load === undefined)
        return yield* new ThreadInsightsError({ message: "This item has no readable text." });
      const text = yield* load;
      return {
        itemId: input.itemId,
        text: text.slice(0, MAX_READ_BYTES),
        truncated: text.length > MAX_READ_BYTES,
      };
    }),
  });
});

export const layer = Layer.effect(DefaultContext, make);
