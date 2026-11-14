import type { DefaultContextItem, InstructionFootprint } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Where a provider documents its instruction files. Groups list alternatives: the first existing name wins. */
export interface FileConvention {
  readonly globals: (dirs: ProviderDirs) => ReadonlyArray<ReadonlyArray<string>>;
  readonly globalRuleDirs?: (dirs: ProviderDirs) => ReadonlyArray<string>;
  /** `home`: cwd and its ancestors inside $HOME. `git`: git root down to cwd. `nearest`: first match walking up to the git root. `root`: the git root (or cwd). */
  readonly walk: "home" | "git" | "nearest" | "root";
  readonly perDir: ReadonlyArray<ReadonlyArray<string>>;
  readonly ruleDirs?: ReadonlyArray<string>;
  readonly ruleExtension?: string;
  readonly ruleApplies?: (frontmatter: string) => boolean;
  readonly imports?: boolean;
}

export interface ProviderDirs {
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
}

const inHome = (dirs: ProviderDirs, ...parts: string[]) => [dirs.home, ...parts].join("/");

export const FILE_CONVENTIONS: Readonly<Record<string, FileConvention>> = {
  claudeAgent: {
    globals: (dirs) => [
      [
        dirs.platform === "darwin"
          ? "/Library/Application Support/ClaudeCode/CLAUDE.md"
          : "/etc/claude-code/CLAUDE.md",
      ],
      [`${dirs.env.CLAUDE_CONFIG_DIR || inHome(dirs, ".claude")}/CLAUDE.md`],
    ],
    globalRuleDirs: (dirs) => [`${dirs.env.CLAUDE_CONFIG_DIR || inHome(dirs, ".claude")}/rules`],
    walk: "home",
    perDir: [["CLAUDE.md"], [".claude/CLAUDE.md"], ["CLAUDE.local.md"]],
    ruleDirs: [".claude/rules"],
    ruleApplies: (frontmatter) => !/^paths\s*:/m.test(frontmatter),
    imports: true,
  },
  codex: {
    globals: (dirs) => {
      const home = dirs.env.CODEX_HOME || inHome(dirs, ".codex");
      return [[`${home}/AGENTS.override.md`, `${home}/AGENTS.md`]];
    },
    walk: "git",
    perDir: [["AGENTS.override.md", "AGENTS.md"]],
  },
  opencode: {
    globals: (dirs) => [
      [inHome(dirs, ".config/opencode/AGENTS.md"), inHome(dirs, ".claude/CLAUDE.md")],
    ],
    walk: "nearest",
    perDir: [["AGENTS.md", "CLAUDE.md"]],
  },
  cursor: {
    globals: () => [],
    walk: "root",
    perDir: [["AGENTS.md"], [".cursorrules"]],
    ruleDirs: [".cursor/rules"],
    ruleExtension: ".mdc",
    ruleApplies: (frontmatter) => /^alwaysApply\s*:\s*true/m.test(frontmatter),
  },
  pi: {
    globals: (dirs) => {
      const agent = dirs.env.PI_CODING_AGENT_DIR || inHome(dirs, ".pi/agent");
      return [[`${agent}/AGENTS.md`, `${agent}/CLAUDE.md`]];
    },
    walk: "home",
    perDir: [["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"]],
  },
  kiro: {
    globals: () => [],
    globalRuleDirs: (dirs) => [inHome(dirs, ".kiro/steering")],
    walk: "root",
    perDir: [["AGENTS.md"]],
    ruleDirs: [".kiro/steering"],
    ruleApplies: (frontmatter) =>
      !/^inclusion\s*:/m.test(frontmatter) || /^inclusion\s*:\s*always/m.test(frontmatter),
  },
  grok: {
    globals: () => [],
    walk: "git",
    perDir: [
      ["AGENTS.md"],
      ["Agents.md"],
      ["AGENT.md"],
      ["CLAUDE.md"],
      ["Claude.md"],
      ["CLAUDE.local.md"],
    ],
    ruleDirs: [".grok/rules"],
  },
  antigravity: {
    globals: (dirs) =>
      ["GEMINI.md", "AGENTS.md", "config/GEMINI.md", "config/AGENTS.md"].map((name) => [
        inHome(dirs, ".gemini", name),
      ]),
    globalRuleDirs: (dirs) => [inHome(dirs, ".gemini/config/rules")],
    walk: "root",
    perDir: [["AGENTS.md"], ["GEMINI.md"], [".agents/AGENTS.md"], [".agents/GEMINI.md"]],
    ruleDirs: [".agents/rules", ".agent/rules"],
    ruleApplies: (frontmatter) =>
      !/^trigger\s*:/m.test(frontmatter) || /^trigger\s*:\s*always_on/m.test(frontmatter),
  },
};

const SECRET_NAME =
  /^\.env(\..*)?$|\.(pem|key|p12|pfx|keystore)$|^id_|^\.netrc$|^\.npmrc$|^\.pgpass$|^credentials|^secrets?(\.|$)|^auth\.json$/i;
const MAX_FILES = 64;
const MAX_IMPORT_DEPTH = 5;
export const MAX_READ_BYTES = 256 * 1024;

export interface ResolvedFile {
  /** The documented path, before symlinks resolve. */
  readonly path: string;
  readonly realPath: string;
  readonly scope: "global" | "project" | "rule" | "import";
  readonly bytes: number;
  readonly depth: number;
  readonly status: "expected" | "outside-home" | "secret";
}

/** `@path` references outside code spans and fences, as Claude Code resolves imports. */
export function importReferences(text: string): ReadonlyArray<string> {
  const prose = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[\w.\-/]+)/g)].flatMap((match) =>
    match[1] === undefined || /^[.\-/]*$/.test(match[1]) ? [] : [match[1].replace(/\.+$/, "")],
  );
}

const frontmatterOf = (text: string) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";

/**
 * Resolves the files a provider documents loading for this cwd. Reads happen only inside
 * $HOME, the workspace, or the provider's own documented global paths; anything else is
 * listed by path and left unread.
 */
export const resolveInstructionFiles = Effect.fn("DefaultContext.resolveInstructionFiles")(
  function* (convention: FileConvention, cwd: string, dirs: ProviderDirs) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const real = (file: string) => fs.realPath(file).pipe(Effect.orElseSucceed(() => file));
    const isFile = (file: string) =>
      fs.stat(file).pipe(
        Effect.map((info) => (info.type === "File" ? Number(info.size) : null)),
        Effect.orElseSucceed(() => null),
      );
    const isDir = (dir: string) =>
      fs.stat(dir).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.orElseSucceed(() => false),
      );
    const within = (root: string, file: string) => {
      const relative = path.relative(root, file);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    };
    const home = yield* real(dirs.home);
    const workspace = yield* real(cwd);
    let gitRoot: string | null = null;
    for (let dir = workspace; ; dir = path.dirname(dir)) {
      if (yield* fs.exists(path.join(dir, ".git")).pipe(Effect.orElseSucceed(() => false))) {
        gitRoot = dir;
        break;
      }
      if (path.dirname(dir) === dir) break;
    }
    const globalPaths = new Set<string>();
    for (const group of convention.globals(dirs)) for (const file of group) globalPaths.add(file);
    for (const dir of convention.globalRuleDirs?.(dirs) ?? []) globalPaths.add(dir);
    const statusOf = (file: string): ResolvedFile["status"] =>
      SECRET_NAME.test(path.basename(file))
        ? "secret"
        : within(home, file) ||
            within(workspace, file) ||
            (gitRoot !== null && within(gitRoot, file)) ||
            [...globalPaths].some((allowed) => within(allowed, file))
          ? "expected"
          : "outside-home";
    const readText = (file: string) =>
      fs.readFileString(file).pipe(
        Effect.map((text) => text.slice(0, MAX_READ_BYTES)),
        Effect.orElseSucceed(() => ""),
      );

    const files: ResolvedFile[] = [];
    const seen = new Set<string>();
    const add: (
      file: string,
      scope: ResolvedFile["scope"],
      depth: number,
    ) => Effect.Effect<boolean, never, never> = Effect.fnUntraced(function* (file, scope, depth) {
      const bytes = yield* isFile(file);
      if (bytes === null) return false;
      const resolved = yield* real(file);
      if (seen.has(resolved) || files.length >= MAX_FILES) return true;
      seen.add(resolved);
      const status = SECRET_NAME.test(path.basename(file)) ? "secret" : statusOf(resolved);
      files.push({ path: file, realPath: resolved, scope, bytes, depth, status });
      if (convention.imports && status === "expected" && depth < MAX_IMPORT_DEPTH) {
        for (const reference of importReferences(yield* readText(resolved))) {
          const target = reference.startsWith("~/")
            ? path.join(dirs.home, reference.slice(2))
            : path.resolve(path.dirname(file), reference);
          yield* add(target, "import", depth + 1);
        }
      }
      return true;
    });
    const addRules = Effect.fnUntraced(function* (dir: string) {
      if (!(yield* isDir(dir)) || statusOf(yield* real(dir)) !== "expected") return;
      const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
      for (const name of names
        .filter((entry) => entry.endsWith(convention.ruleExtension ?? ".md"))
        .toSorted()) {
        const file = path.join(dir, name);
        if (
          convention.ruleApplies !== undefined &&
          !convention.ruleApplies(frontmatterOf(yield* readText(file)))
        )
          continue;
        yield* add(file, "rule", 0);
      }
    });

    for (const group of convention.globals(dirs)) {
      for (const file of group) if (yield* add(file, "global", 0)) break;
    }
    for (const dir of convention.globalRuleDirs?.(dirs) ?? []) yield* addRules(dir);

    const top = gitRoot ?? workspace;
    const chain: string[] = [];
    if (convention.walk === "root") chain.push(top);
    else if (convention.walk === "home") {
      for (let dir = workspace; ; dir = path.dirname(dir)) {
        chain.unshift(dir);
        if (dir === home || !within(home, dir) || path.dirname(dir) === dir) break;
      }
    } else {
      for (let dir = workspace; ; dir = path.dirname(dir)) {
        chain.unshift(dir);
        if (dir === top || path.dirname(dir) === dir) break;
      }
    }
    if (convention.walk === "nearest") chain.reverse();
    walk: for (const dir of chain) {
      let found = false;
      for (const group of convention.perDir) {
        for (const name of group) {
          if (yield* add(path.join(dir, name), "project", 0)) {
            found = true;
            break;
          }
        }
      }
      if (found && convention.walk === "nearest") break walk;
    }
    for (const base of new Set([top, workspace])) {
      for (const dir of convention.ruleDirs ?? []) yield* addRules(path.join(base, dir));
    }
    return { files, cwd: workspace };
  },
);

export interface FileRow extends ResolvedFile {
  readonly loaded?: boolean;
  readonly unexpected?: boolean;
}

/** Marks expected files against the paths the provider reported loading last turn. */
export function reconcileFiles(
  files: ReadonlyArray<ResolvedFile>,
  sources: InstructionFootprint["instructionSources"],
): ReadonlyArray<FileRow> {
  if (sources === undefined) return files;
  const reported = new Set(sources.map((source) => source.path));
  const expected = new Set(files.flatMap((file) => [file.path, file.realPath]));
  return [
    ...files.map((file) => ({
      ...file,
      loaded: reported.has(file.path) || reported.has(file.realPath),
    })),
    ...sources
      .filter((source) => !expected.has(source.path))
      .map((source) => ({
        path: source.path,
        realPath: source.path,
        scope: "project" as const,
        bytes: source.bytes ?? 0,
        depth: 0,
        status: "expected" as const,
        unexpected: true,
      })),
  ];
}

export const fileStatus = (file: FileRow): NonNullable<DefaultContextItem["status"]> =>
  file.status !== "expected"
    ? file.status
    : file.unexpected
      ? "unexpected"
      : file.loaded === undefined
        ? "expected"
        : file.loaded
          ? "loaded"
          : "not-loaded";
