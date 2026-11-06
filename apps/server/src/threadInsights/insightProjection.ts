import type { OrchestrationV2TurnItem, ThreadLoadEvent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const instructionPath =
  /(?:^|[/\\])(?:AGENTS\.md|CLAUDE\.md|MEMORY\.md|LOCAL\.md|[^/\\]*instructions?[^/\\]*\.(?:md|txt))$/i;
const skillPath = /(?:^|[/\\])SKILL\.md$/i;
const pathKeys = new Set([
  "path",
  "file_path",
  "filePath",
  "filename",
  "fileName",
  "uri",
  "resource",
  "main_resource",
]);

function inputPaths(input: unknown): string[] {
  if (typeof input !== "object" || input === null) return [];
  return Object.entries(input).flatMap(([key, value]) => {
    if (pathKeys.has(key) && typeof value === "string") return [value];
    if ((key === "paths" || key === "files") && Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
    return [];
  });
}

function outputText(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (output === undefined || output === null) return null;
  // Provider tool results are JSON values; count their rendered payload without retaining it.
  try {
    return JSON.stringify(output);
  } catch {
    return null;
  }
}

function shellCommand(input: string): string {
  // Codex reports the shell invocation, including shell-word quoting, rather than just its script.
  const wrapped = input.match(/^(?:\S*\/)?(?:ba|z|da|k)?sh\s+-[a-z]*c\s+(['"])([\s\S]*)\1$/);
  if (!wrapped) return input;
  const script = wrapped[2] ?? "";
  return wrapped[1] === "'"
    ? script.replaceAll("'\\''", "'")
    : script.replace(/\\(["\\$`])/g, "$1");
}

export function projectLoadEvent(item: OrchestrationV2TurnItem): ThreadLoadEvent | null {
  let paths: string[] = [];
  let toolName: string;
  let kind: ThreadLoadEvent["kind"] = "file";
  let evidence: ThreadLoadEvent["evidence"] = "reported";
  let output: string | null = null;
  let label: string | undefined;
  if (item.type === "file_search") {
    toolName = "file_search";
    kind = "search";
    paths = item.results?.map((entry) => entry.fileName) ?? [];
  } else if (item.type === "dynamic_tool") {
    toolName = item.toolName ?? "tool";
    if (/^Skill$/i.test(toolName) || /skill.*(?:read|load)|(?:read|load).*skill/i.test(toolName)) {
      kind = "skill";
      if (
        typeof item.input === "object" &&
        item.input !== null &&
        "skill" in item.input &&
        typeof item.input.skill === "string"
      )
        label = item.input.skill;
    } else if (/read.*resource|resource.*read/i.test(toolName)) kind = "resource";
    else if (/search|glob|grep/i.test(toolName)) kind = "search";
    else if (
      !/(?:^|[._/])(?:read|read_file|readfile|read_text_file|open_file|view_image)(?:$|[._/])/i.test(
        toolName,
      )
    )
      return null;
    paths = inputPaths(item.input);
    output = item.outputOmitted ? null : outputText(item.output);
  } else if (item.type === "command_execution") {
    const command = shellCommand(item.input);
    if (!/(?:^|[\s;&|])(?:cat|sed|head|tail|rg|grep|less|more)\s/.test(command)) return null;
    evidence = "inferred";
    toolName = "shell";
    kind = /(?:^|[\s;&|])(?:rg|grep)\s/.test(command) ? "search" : "file";
    // Shell commands are evidence of intent, not proof that every named path was loaded.
    paths = [
      ...command.matchAll(
        /(?:["']([^"'\n]+(?:\.[\w-]+|\/SKILL\.md))["']|((?:\.{0,2}\/|~\/)[^\s;|&"']+)|(?:^|\s)([^\s;|&"'<>]+\.[\w-]+)(?=\s|$|[;|&<>]))/g,
      ),
    ].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
    output = item.outputOmitted ? null : (item.output ?? null);
  } else return null;
  paths = [...new Set(paths)];
  if (kind !== "search") {
    if (paths.some((path) => skillPath.test(path))) kind = "skill";
    else if (paths.some((path) => instructionPath.test(path))) kind = "instructions";
  }
  const outputBytes = output === null ? null : bytes(output);
  return {
    itemId: item.id,
    runId: item.runId,
    at: DateTime.formatIso(item.startedAt ?? item.updatedAt),
    kind,
    label:
      label ??
      paths[0] ??
      (kind === "search" ? "File search" : kind === "skill" ? "Skill read" : "Resource read"),
    paths,
    toolName,
    evidence,
    status:
      item.type === "command_execution" && item.exitCode != null && item.exitCode !== 0
        ? "failed"
        : item.status,
    outputBytes,
    estimatedOutputTokens: outputBytes === null ? null : Math.ceil(outputBytes / 4),
  };
}
