#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalConsole:off - The detached worker runs under Electron without repository dependencies.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";

const activeStatuses = ["preparing", "queued", "starting", "running"];
// The ownership database holds a lifetime lock and must never enter a backup.
const stateFiles = [
  "settings.json",
  "keybindings.json",
  "environment-id",
  "anonymous-id",
  "secrets",
  "thread-workspaces",
  "thread-notes",
  "themes",
  "desktop-settings.json",
  "client-settings.json",
  "saved-environments.json",
];

function run(
  command: string,
  args: string[],
  options: Parameters<typeof NodeChildProcess.spawnSync>[2] = {},
) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `${command} exited ${result.status}${result.stderr ? `: ${String(result.stderr).trim()}` : ""}`,
    );
  return String(result.stdout ?? "").trim();
}

async function backupState(source: string, destination: string) {
  const { DatabaseSync, backup } = await import("node:sqlite");
  NodeFS.mkdirSync(destination, { mode: 0o700 });
  const database = NodePath.join(source, "statev2.sqlite");
  if (NodeFS.existsSync(database)) {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      await backup(db, NodePath.join(destination, "statev2.sqlite"));
    } finally {
      db.close();
    }
    NodeFS.chmodSync(NodePath.join(destination, "statev2.sqlite"), 0o600);
  }
  for (const name of stateFiles) {
    const file = NodePath.join(source, name);
    if (NodeFS.existsSync(file))
      NodeFS.cpSync(file, NodePath.join(destination, name), {
        recursive: true,
        dereference: false,
      });
  }
  return { backedUp: true, path: destination };
}

async function health(home: string, digest: string) {
  try {
    const runtime = JSON.parse(
      NodeFS.readFileSync(NodePath.join(home, "userdata/server-runtime.json"), "utf8"),
    );
    const executable = NodeFS.realpathSync(`/proc/${runtime.pid}/exe`);
    const expected = NodePath.join(home, "wsl-runtime", `sha256-${digest}`, "t3");
    if (executable !== expected) return { healthy: false };
    const healthy = await fetch(`http://127.0.0.1:${runtime.port}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(2000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    return { healthy, executable, pid: runtime.pid, port: runtime.port };
  } catch {
    return { healthy: false };
  }
}

async function idle(home: string, authorizationFile?: string) {
  if (authorizationFile) {
    const runtime = JSON.parse(
      NodeFS.readFileSync(NodePath.join(home, "userdata/server-runtime.json"), "utf8"),
    );
    const authorization = NodeFS.readFileSync(authorizationFile, "utf8").trim();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization,
    };
    const endpoint = `http://127.0.0.1:${runtime.port}/mcp`;
    async function request(message: unknown) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Drain MCP returned HTTP ${response.status}`);
      const session = response.headers.get("mcp-session-id");
      if (session) headers["mcp-session-id"] = session;
      const text = await response.text();
      const payload = response.headers.get("content-type")?.includes("text/event-stream")
        ? text
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => JSON.parse(line.slice(5)))
            .find((value) => value.id !== undefined)
        : text
          ? JSON.parse(text)
          : undefined;
      if (payload?.error) throw new Error(`Drain MCP failed: ${JSON.stringify(payload.error)}`);
      return payload?.result;
    }
    try {
      await request({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "weavewing-local-update", version: "1" },
        },
      });
      headers["mcp-protocol-version"] = "2025-03-26";
      await request({ jsonrpc: "2.0", method: "notifications/initialized" });
      const result = await request({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "t3_thread_list",
          arguments: {
            allProjects: true,
            includeSubagents: true,
            statuses: activeStatuses,
            limit: 1,
          },
        },
      });
      if (result?.isError || !Number.isInteger(result?.structuredContent?.total))
        throw new Error("Drain MCP returned no thread count");
      return {
        idle: result.structuredContent.total === 0,
        active: result.structuredContent.total,
        source: "mcp",
      };
    } finally {
      if (headers["mcp-session-id"])
        await fetch(endpoint, {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(2000),
        }).catch(() => undefined);
    }
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(NodePath.join(home, "userdata/statev2.sqlite"), { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT count(*) AS count FROM orchestration_v2_projection_runs WHERE status IN (${activeStatuses.map(() => "?").join(",")})`,
      )
      .get(...activeStatuses);
    return { idle: row?.count === 0, active: Number(row?.count), source: "read-only-sqlite" };
  } finally {
    db.close();
  }
}

async function worker(mode: string, configFile: string, extra: string[]) {
  const config = JSON.parse(NodeFS.readFileSync(configFile, "utf8"));
  if (mode === "backup")
    return backupState(
      NodePath.join(config.wslHome, "userdata"),
      NodePath.join(config.output, "backup-wsl"),
    );
  if (mode === "backup-windows")
    return backupState(
      NodePath.join(NodeOS.homedir(), ".t3/userdata"),
      NodePath.join(NodePath.dirname(configFile), "backup-windows"),
    );
  if (mode === "idle") return idle(config.wslHome, config.authorizationFile);
  if (mode === "health") return health(config.wslHome, extra[0]!);
  if (mode === "stopped") {
    try {
      NodeFS.statSync(`/proc/${extra[0]!}`);
      return { stopped: false };
    } catch {
      return { stopped: true };
    }
  }
  if (mode === "notify") {
    const current = await health(config.wslHome, extra[0]!);
    if (!current.healthy || !current.executable)
      throw new Error("No healthy runtime for notification");
    run(
      current.executable,
      ["thread", "send", "--base-dir", config.wslHome, "--json", config.notifyThread, extra[1]!],
      { stdio: "pipe", timeout: 30000 },
    );
    return { sent: true };
  }
  if (mode === "native") {
    const { FileFinder } = await import(
      NodeURL.pathToFileURL(
        NodePath.join(
          extra[0]!,
          "resources/server.asar/node_modules/@ff-labs/fff-node/dist/index.js",
        ),
      ).href
    );
    const result = FileFinder.create({
      basePath: extra[1]!,
      frecencyDbPath: NodePath.join(extra[1]!, "frecency.mdb"),
      historyDbPath: NodePath.join(extra[1]!, "history.mdb"),
      disableWatch: true,
      disableMmapCache: true,
      disableContentIndexing: true,
    });
    if (!result.ok) throw new Error(result.error);
    result.value.destroy();
    return { nativeLoad: true };
  }
  throw new Error(`Unknown worker mode: ${mode}`);
}

async function main() {
  const { values } = NodeUtil.parseArgs({
    options: {
      "install-dir": { type: "string" },
      "output-dir": { type: "string" },
      "vp-home": { type: "string", default: process.env.VP_HOME },
      "patchelf-dir": { type: "string" },
      "linux-monitor": { type: "string" },
      "windows-monitor": { type: "string" },
      "wsl-distro": { type: "string", default: process.env.WSL_DISTRO_NAME },
      "wsl-home": { type: "string", default: NodePath.join(NodeOS.homedir(), ".t3") },
      "drain-minutes": { type: "string", default: "5" },
      "health-seconds": { type: "string", default: "240" },
      "notify-thread": { type: "string" },
      "mcp-authorization-file": { type: "string" },
      "check-only": { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(`Usage: vp run desktop:update-local --install-dir 'C:\\...\\Weavewing' --output-dir /absolute/evidence/run
  --vp-home PATH               Vite Plus home (or VP_HOME), with current/bin/vp
  --patchelf-dir PATH          Directory containing patchelf (otherwise PATH)
  --linux-monitor PATH        Matching release's Linux x64 monitor executable
  --windows-monitor PATH      Matching release's Windows x64 monitor executable
  --wsl-distro NAME           WSL distribution (or WSL_DISTRO_NAME)
  --wsl-home PATH             Installed T3 home (default ~/.t3)
  --drain-minutes N           Wait for active turns, then proceed (default 5, 0 skips)
  --health-seconds N          New/rollback runtime health deadline (default 240)
  --mcp-authorization-file PATH  File containing an MCP Authorization header
  --notify-thread ID          Send the activation result after restart
  --check-only, --dry-run     Build, verify, stage, drain and back up; leave install running`);
    return;
  }
  // oxlint-disable-next-line t3code/no-global-process-runtime -- This standalone WSL driver runs without an Effect runtime.
  if (NodeOS.platform() !== "linux")
    throw new Error("Run this command inside WSL with Windows interop enabled.");
  const repo = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
  const git = (...args: string[]) => run("git", ["-C", repo, ...args], { stdio: "pipe" });
  if (git("status", "--porcelain"))
    throw new Error(
      "Commit or remove worktree changes before updating; the build requires a clean tree.",
    );
  for (const name of [
    "install-dir",
    "output-dir",
    "vp-home",
    "linux-monitor",
    "windows-monitor",
    "wsl-distro",
  ] as const) {
    if (!values[name]) throw new Error(`Missing --${name}. See --help.`);
  }
  const output = values["output-dir"]!;
  if (!NodePath.isAbsolute(output) || NodeFS.existsSync(output))
    throw new Error(
      "--output-dir must be a new absolute directory, outside the installation and candidate.",
    );
  const vpHome = values["vp-home"]!;
  const vp = NodePath.join(vpHome, "current/bin/vp");
  for (const file of [vp, values["linux-monitor"]!, values["windows-monitor"]!]) {
    if (!NodeFS.statSync(file, { throwIfNoEntry: false })?.isFile())
      throw new Error(`Required toolchain file is missing: ${file}`);
  }
  const drainMinutes = Number(values["drain-minutes"]);
  const healthSeconds = Number(values["health-seconds"]);
  if (
    !Number.isFinite(drainMinutes) ||
    drainMinutes < 0 ||
    !Number.isFinite(healthSeconds) ||
    healthSeconds <= 0
  )
    throw new Error("Drain must be nonnegative and health deadline must be positive.");
  const manifest = JSON.parse(NodeFS.readFileSync(NodePath.join(repo, "package.json"), "utf8"));
  if (process.versions.node !== manifest.engines.node)
    throw new Error(`Run with Node ${manifest.engines.node}; found ${process.versions.node}.`);
  const version = JSON.parse(
    NodeFS.readFileSync(NodePath.join(repo, "apps/server/package.json"), "utf8"),
  ).version;
  git("diff", "--exit-code", `v${version}`, "--", "native/resource-monitor");
  NodeFS.mkdirSync(output, { mode: 0o700, recursive: true });
  const bin = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "weavewing-update-bin-"));
  try {
    for (const name of ["vp", "vpr", "vpx", "node", "yarn", "yarnpkg", "bun", "bunx"])
      NodeFS.symlinkSync(vp, NodePath.join(bin, name));
    const env = {
      ...process.env,
      VP_HOME: vpHome,
      VP_NODE_VERSION: manifest.engines.node,
      PATH: [bin, values["patchelf-dir"], NodePath.join(vpHome, "fallback-bin"), process.env.PATH]
        .filter(Boolean)
        .join(NodePath.delimiter),
      T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR: "true",
      T3CODE_DESKTOP_UPDATE_REPOSITORY: "koreyGambill/t3code",
    };
    const build = (command: string, args: string[], cwd = repo) => run(command, args, { cwd, env });
    build("patchelf", ["--version"]);
    build("vp", ["--version"]);
    const powershell = (args: string[]) =>
      run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args],
        { stdio: ["ignore", "inherit", "inherit"] },
      );
    const windowsPath = (file: string) => run("wslpath", ["-w", file], { stdio: "pipe" });
    const activation = NodePath.join(output, "activate.ps1");
    NodeFS.copyFileSync(NodePath.join(repo, "scripts/activate-local-desktop.ps1"), activation);
    NodeFS.copyFileSync(
      NodePath.join(repo, "scripts/stage-windows-desktop.ps1"),
      NodePath.join(output, "stage-windows-desktop.ps1"),
    );
    NodeFS.writeFileSync(
      NodePath.join(output, "worker.mjs"),
      NodeModule.stripTypeScriptTypes(
        NodeFS.readFileSync(NodeURL.fileURLToPath(import.meta.url), "utf8"),
      ),
    );
    const config = {
      output,
      commit: git("rev-parse", "HEAD"),
      install: values["install-dir"],
      distro: values["wsl-distro"],
      wslHome: values["wsl-home"],
      node: process.execPath,
      drainMinutes,
      healthSeconds,
      checkOnly: !!(values["check-only"] || values["dry-run"]),
      notifyThread: values["notify-thread"],
      authorizationFile: values["mcp-authorization-file"],
      source: windowsPath(NodePath.join(output, "windows/win-unpacked")),
      digest: "",
      exeHash: "",
    };
    const configFile = NodePath.join(output, "config.json");
    const saveConfig = () =>
      NodeFS.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
    saveConfig();
    powershell([
      "-File",
      windowsPath(activation),
      "-ConfigPath",
      windowsPath(configFile),
      "-Mode",
      "Preflight",
    ]);
    if (!NodeFS.existsSync(NodePath.join(repo, "node_modules"))) build("vp", ["i"]);
    const windowsMonitor = NodePath.join(
      repo,
      "native/resource-monitor/target/x86_64-pc-windows-msvc/release/t3-resource-monitor.exe",
    );
    NodeFS.mkdirSync(NodePath.dirname(windowsMonitor), { recursive: true });
    NodeFS.copyFileSync(values["windows-monitor"]!, windowsMonitor);
    build("vp", ["run", "--filter", "t3", "build"]);
    build("node", ["apps/desktop/scripts/build-preview-annotation-css.mjs"]);
    build("vp", ["pack"], NodePath.join(repo, "apps/desktop"));
    build("node", ["apps/server/scripts/cli.ts", "build-exe", "--verbose"]);
    build("node", [
      "scripts/build-cli-archive.ts",
      "--platform",
      "linux",
      "--arch",
      "x64",
      "--version",
      version,
      "--resource-monitor-dir",
      values["linux-monitor"]!,
      "--output-dir",
      NodePath.join(output, "current"),
    ]);
    const archive = NodePath.join(output, "current", `t3-${version}-linux-x64.tar.gz`);
    build("node", [
      "scripts/smoke-cli-archive.ts",
      "--archive",
      archive,
      "--expect-version",
      version,
    ]);
    build("node", [
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "win",
      "--target",
      "dir",
      "--arch",
      "x64",
      "--build-version",
      version,
      "--skip-build",
      "--wsl-runtime",
      archive,
      "--output-dir",
      NodePath.join(output, "windows"),
      "--verbose",
    ]);
    const hash = (file: string) =>
      NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(file)).digest("hex");
    config.digest = hash(archive);
    config.exeHash = hash(NodePath.join(output, "windows/win-unpacked/Weavewing.exe"));
    saveConfig();
    if (git("status", "--porcelain") || config.commit !== git("rev-parse", "HEAD"))
      throw new Error("Source changed during the build; refusing activation.");
    powershell([
      "-File",
      windowsPath(activation),
      "-ConfigPath",
      windowsPath(configFile),
      "-Mode",
      "Prepare",
    ]);
    powershell([
      "-File",
      windowsPath(activation),
      "-ConfigPath",
      windowsPath(configFile),
      "-Mode",
      config.checkOnly ? "Activate" : "Launch",
    ]);
    console.log(
      `${config.checkOnly ? "Check complete" : "Windows activation detached"}. Receipt: ${NodePath.join(output, "receipt.json")}`,
    );
  } finally {
    NodeFS.rmSync(bin, { recursive: true, force: true });
  }
}

try {
  if (process.argv[2] === "--worker")
    console.log(
      JSON.stringify(await worker(process.argv[3]!, process.argv[4]!, process.argv.slice(5))),
    );
  else await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
