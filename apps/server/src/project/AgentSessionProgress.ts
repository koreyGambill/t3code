// @effect-diagnostics nodeBuiltinImport:off - Positioned reads and bigint file identities prevent following replaced provider transcripts.
import * as NodeFSP from "node:fs/promises";
import * as NodeConstants from "node:constants";
import * as NodePath from "node:path";

import {
  AgentSessionImportSource,
  ClaudeSettings,
  type AgentSessionProgressInput,
  type AgentSessionProgressResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectService from "./ProjectService.ts";
import { parseAgentSessionTranscript } from "./AgentSessionScanner.ts";

const decodeClaudeSettings = Schema.decodeOption(ClaudeSettings);
const MAX_PROGRESS_BYTES = 1024 * 1024;
const decodeSources = Schema.decodeUnknownOption(
  Schema.Struct({
    cwd: Schema.String,
    importedTranscripts: Schema.Array(AgentSessionImportSource),
  }),
);
const empty = (status: "unavailable" | "continued"): AgentSessionProgressResult => ({
  status,
  messages: [],
  updatedAt: null,
  truncated: false,
});

/** Reads complete JSONL records from a bounded tail without changing the provider transcript. */
export async function readSourceProgress(
  source: AgentSessionImportSource,
  projectsDirectory: string,
): Promise<AgentSessionProgressResult> {
  try {
    if (typeof source.inode === "number" && !Number.isSafeInteger(source.inode))
      return empty("unavailable");
    const root = await NodeFSP.realpath(projectsDirectory);
    const filePath = await NodeFSP.realpath(source.filePath);
    const relative = NodePath.relative(root, filePath);
    if (
      !relative ||
      relative.startsWith(`..${NodePath.sep}`) ||
      relative === ".." ||
      NodePath.isAbsolute(relative)
    )
      return empty("unavailable");
    const file = await NodeFSP.open(
      filePath,
      NodeConstants.O_RDONLY | NodeConstants.O_NONBLOCK | NodeConstants.O_NOFOLLOW,
    );
    try {
      const before = await file.stat({ bigint: true });
      const sameFile = (stats: typeof before) =>
        stats.isFile() &&
        Number(stats.dev) === source.device &&
        source.inode !== null &&
        String(stats.ino) === String(source.inode) &&
        (source.birthtimeMs === null || Number(stats.birthtimeMs) === source.birthtimeMs) &&
        Number(stats.size) >= source.size;
      if (!sameFile(before)) return empty("unavailable");
      const size = Number(before.size);
      const start = Math.max(0, size - MAX_PROGRESS_BYTES);
      const buffer = Buffer.alloc(size - start);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      let contents = buffer.subarray(0, bytesRead).toString("utf8");
      const truncated = start > 0;
      if (truncated) contents = contents.slice(contents.indexOf("\n") + 1);
      // Claude may still be writing the final JSON record.
      contents = contents.slice(0, contents.lastIndexOf("\n") + 1);
      const after = await file.stat({ bigint: true });
      const named = await NodeFSP.stat(filePath, { bigint: true });
      if (!sameFile(after) || !sameFile(named) || after.size < before.size)
        return empty("unavailable");
      const parsed = parseAgentSessionTranscript({
        source: "claudeAgent",
        providerInstanceId: source.providerInstanceId,
        fallbackSessionId: source.providerSessionId,
        lastActiveAtMs: Number(before.mtimeMs),
        // The import parser requires a first user message; a tail can contain only assistant output.
        contents: JSON.stringify({ type: "user", message: { content: "_" } }) + "\n" + contents,
      });
      if (parsed !== null && parsed.providerSessionId !== source.providerSessionId)
        return empty("unavailable");
      return {
        status: "following",
        messages: parsed?.messages.slice(1).slice(-20) ?? [],
        updatedAt: DateTime.formatIso(DateTime.makeUnsafe(Number(before.mtimeMs))),
        truncated:
          truncated ||
          (parsed?.omittedMessageCount ?? 0) > 0 ||
          (parsed?.messages.length ?? 0) > 21,
      };
    } finally {
      await file.close();
    }
  } catch {
    return empty("unavailable");
  }
}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const runtimes = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
  const projects = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const home = yield* HostProcess.HomeDirectory;
  const environment = yield* HostProcess.Environment;
  const progress = Effect.fn("AgentSessionProgress.progress")(
    function* (input: AgentSessionProgressInput) {
      const records = yield* orchestrator.getThreadRecords(input.threadId, [
        "runs",
        "providerThreads",
      ]);
      if (records.runs.length > 0) return empty("continued");
      const thread = records.thread;
      if (thread.historyOrigin !== "v1_import" || thread.deletedAt !== null)
        return empty("unavailable");
      const runtime = yield* runtimes.getByThreadId(input);
      if (
        Option.isNone(runtime) ||
        runtime.value.providerName !== "claudeAgent" ||
        thread.providerInstanceId !== runtime.value.providerInstanceId
      )
        return empty("unavailable");
      const payload = decodeSources(runtime.value.runtimePayload);
      const project = yield* projects.getById(thread.projectId);
      if (
        Option.isNone(payload) ||
        Option.isNone(project) ||
        project.value.deletedAt !== null ||
        normalizeProjectPathForComparison(project.value.workspaceRoot) !==
          normalizeProjectPathForComparison(payload.value.cwd)
      )
        return empty("unavailable");
      const source = payload.value.importedTranscripts.find(
        (candidate) =>
          candidate.provider === "claudeAgent" &&
          candidate.providerInstanceId === runtime.value.providerInstanceId &&
          input.threadId ===
            `import:${candidate.providerInstanceId}:${candidate.providerSessionId}` &&
          records.providerThreads.some(
            (providerThread) =>
              providerThread.id === thread.activeProviderThreadId &&
              providerThread.driver === "claudeAgent" &&
              providerThread.providerInstanceId === candidate.providerInstanceId &&
              providerThread.nativeThreadRef?.nativeId === candidate.providerSessionId,
          ),
      );
      if (!source) return empty("unavailable");
      const storedSettings = yield* settings.getSettings;
      const instance = storedSettings.providerInstances[source.providerInstanceId];
      if (
        (instance && instance.driver !== "claudeAgent") ||
        (!instance && source.providerInstanceId !== "claudeAgent")
      )
        return empty("unavailable");
      const config = decodeClaudeSettings(instance?.config ?? {});
      if (Option.isNone(config)) return empty("unavailable");
      const environmentHome =
        instance?.environment?.findLast((entry) => entry.name === "CLAUDE_CONFIG_DIR")?.value ??
        environment.CLAUDE_CONFIG_DIR;
      const configHome =
        config.value.homePath.trim() ||
        (typeof environmentHome === "string" ? environmentHome.trim() : "") ||
        NodePath.join(home, ".claude");
      const result = yield* Effect.promise(() =>
        readSourceProgress(source, NodePath.join(expandHomePath(configHome, home), "projects")),
      );
      // A T3 turn can start while the transcript is being read.
      const latest = yield* orchestrator.getThreadRecords(input.threadId, ["runs"]);
      return latest.runs.length > 0 ? empty("continued") : result;
    },
    Effect.orElseSucceed(() => empty("unavailable")),
  );
  return { progress };
});

export class AgentSessionProgress extends Context.Service<
  AgentSessionProgress,
  Effect.Success<typeof make>
>()("t3/project/AgentSessionProgress") {}
export const layer = Layer.effect(AgentSessionProgress, make);
