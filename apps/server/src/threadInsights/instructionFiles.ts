import {
  type DefaultContextItem,
  type InstructionFootprint,
  ThreadInsightsError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

/** Where a provider documents its instruction files. Groups list alternatives: the first existing name wins. */
export interface FileConvention {
  readonly globals: (dirs: ProviderDirs) => ReadonlyArray<ReadonlyArray<string>>;
  readonly globalRuleDir?: (dirs: ProviderDirs) => string;
  /** `home`: cwd and its ancestors inside $HOME. `git`: git root down to cwd. */
  readonly walk: "home" | "git";
  readonly perDir: ReadonlyArray<ReadonlyArray<string>>;
  readonly ruleDir?: string;
  readonly imports?: boolean;
}

export interface ProviderDirs {
  readonly home: string;
  readonly platform: NodeJS.Platform;
  /** The provider's resolved config folder: Claude's config dir or Codex's home. */
  readonly configDir: string;
}

export const FILE_CONVENTIONS: Readonly<Record<string, FileConvention>> = {
  claudeAgent: {
    globals: (dirs) => [
      [
        dirs.platform === "darwin"
          ? "/Library/Application Support/ClaudeCode/CLAUDE.md"
          : "/etc/claude-code/CLAUDE.md",
      ],
      [`${dirs.configDir}/CLAUDE.md`],
    ],
    globalRuleDir: (dirs) => `${dirs.configDir}/rules`,
    walk: "home",
    perDir: [["CLAUDE.md"], [".claude/CLAUDE.md"], ["CLAUDE.local.md"]],
    ruleDir: ".claude/rules",
    imports: true,
  },
  codex: {
    globals: (dirs) => [[`${dirs.configDir}/AGENTS.override.md`, `${dirs.configDir}/AGENTS.md`]],
    walk: "git",
    perDir: [["AGENTS.override.md", "AGENTS.md"]],
  },
};

const SECRET_NAME =
  /^\.?env(\..*|rc)?$|\.(pem|key|p12|pfx|keystore|kdbx)$|^id_|^\.?netrc$|^\.npmrc$|^\.pgpass$|^\.?credentials|^\.git-credentials$|^secrets?(\.|$)|^auth\.json$|^hosts\.ya?ml$|_history$/i;
const SECRET_PATH = /\/\.(ssh|gnupg|aws|docker|kube|t3)\//;
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
  readonly status: "expected" | "not-read" | "secret";
}

/** `@path` references outside code spans and fences, as Claude Code resolves imports. */
export function importReferences(text: string): ReadonlyArray<string> {
  const prose = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[\w.\-/]+)/g)].flatMap((match) =>
    match[1] === undefined || /^[.\-/]*$/.test(match[1]) ? [] : [match[1].replace(/\.+$/, "")],
  );
}

/** Reads at most MAX_READ_BYTES of a file that still resolves to `realPath`, so a swapped symlink is refused. */
export const readBounded = Effect.fn("DefaultContext.readBounded")(function* (realPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const bytes = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* fs.open(realPath, { flag: "r" });
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_READ_BYTES) {
        const chunk = yield* handle.readAlloc(MAX_READ_BYTES - total);
        if (Option.isNone(chunk) || chunk.value.length === 0) break;
        chunks.push(chunk.value);
        total += chunk.value.length;
      }
      return Buffer.concat(chunks);
    }),
  );
  if ((yield* fs.realPath(realPath)) !== realPath)
    return yield* new ThreadInsightsError({ message: "The file moved while it was read." });
  return bytes.toString("utf8");
});

/**
 * Resolves the files a provider documents loading for this cwd. Text is read only from the
 * repository (workspace and git root), the documented files themselves, and `.md` files a
 * user-owned instruction file imports. Anything else is listed by path and left unread.
 */
export const resolveInstructionFiles = Effect.fn("DefaultContext.resolveInstructionFiles")(
  function* (
    convention: FileConvention,
    cwd: string,
    dirs: ProviderDirs,
    isServerInternal: (file: string) => Effect.Effect<boolean>,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const real = (file: string) => fs.realPath(file).pipe(Effect.orElseSucceed(() => file));
    const sizeOf = (file: string, type: "File" | "Directory") =>
      fs.stat(file).pipe(
        Effect.map((info) => (info.type === type ? Number(info.size) : null)),
        Effect.orElseSucceed(() => null),
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
    const repo = gitRoot ?? workspace;
    const inRepo = (file: string) => within(repo, file) || within(workspace, file);
    const blocked = (file: string) =>
      SECRET_NAME.test(path.basename(file)) || SECRET_PATH.test(`${file}/`);
    const readText = (file: string) =>
      readBounded(file).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.orElseSucceed(() => ""),
      );

    const files: ResolvedFile[] = [];
    const seen = new Set<string>();
    /** `trusted`: the file sits outside the repository, where the repository cannot plant it. */
    const add: (
      file: string,
      scope: ResolvedFile["scope"],
      depth: number,
      trusted: boolean,
    ) => Effect.Effect<boolean, never, never> = Effect.fnUntraced(
      function* (file, scope, depth, trusted) {
        const bytes = yield* sizeOf(file, "File");
        if (bytes === null) return false;
        const resolved = yield* real(file);
        if (seen.has(resolved) || files.length >= MAX_FILES) return true;
        seen.add(resolved);
        const status: ResolvedFile["status"] =
          blocked(file) || blocked(resolved) || (yield* isServerInternal(resolved))
            ? "secret"
            : inRepo(resolved) || (trusted && resolved.endsWith(".md"))
              ? "expected"
              : "not-read";
        files.push({ path: file, realPath: resolved, scope, bytes, depth, status });
        if (convention.imports && status === "expected" && depth < MAX_IMPORT_DEPTH) {
          for (const reference of importReferences(yield* readText(resolved))) {
            const target = reference.startsWith("~/")
              ? path.join(dirs.home, reference.slice(2))
              : path.resolve(path.dirname(file), reference);
            yield* add(target, "import", depth + 1, trusted && !inRepo(resolved));
          }
        }
        return true;
      },
    );
    // Claude Code skips rules scoped to `paths:` until a matching file is read.
    const addRules = Effect.fnUntraced(function* (dir: string, trusted: boolean) {
      if ((yield* sizeOf(dir, "Directory")) === null) return;
      const names = yield* fs
        .readDirectory(dir, { recursive: true })
        .pipe(Effect.orElseSucceed(() => []));
      for (const name of names.filter((entry) => entry.endsWith(".md")).toSorted()) {
        const file = path.join(dir, name);
        const resolved = yield* real(file);
        if (!blocked(resolved) && (inRepo(resolved) || trusted)) {
          const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(yield* readText(resolved))?.[1];
          if (frontmatter !== undefined && /^paths\s*:/m.test(frontmatter)) continue;
        }
        yield* add(file, "rule", 0, trusted);
      }
    });

    for (const group of convention.globals(dirs)) {
      for (const file of group) if (yield* add(file, "global", 0, true)) break;
    }
    if (convention.globalRuleDir) yield* addRules(convention.globalRuleDir(dirs), true);

    const chain: string[] = [];
    for (let dir = workspace; ; dir = path.dirname(dir)) {
      chain.unshift(dir);
      const top = convention.walk === "git" ? dir === repo : dir === home || !within(home, dir);
      if (top || path.dirname(dir) === dir) break;
    }
    for (const dir of chain) {
      for (const group of convention.perDir) {
        for (const name of group) {
          const file = path.join(dir, name);
          if (yield* add(file, "project", 0, !inRepo(dir))) break;
        }
      }
    }
    if (convention.ruleDir) yield* addRules(path.join(workspace, convention.ruleDir), false);
    return { files, cwd: workspace, insideHome: within(home, workspace) };
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
        status: "not-read" as const,
        unexpected: true,
      })),
  ];
}

export const fileStatus = (file: FileRow): NonNullable<DefaultContextItem["status"]> =>
  file.unexpected
    ? "unexpected"
    : file.status !== "expected"
      ? file.status
      : file.loaded === undefined
        ? "expected"
        : file.loaded
          ? "loaded"
          : "not-loaded";
