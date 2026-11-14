import { ClaudeSettings, CodexSettings, type ProviderInstanceConfig } from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { makeIsServerInternalPath } from "../auth/serverInternalPaths.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import {
  resolveCodexHomeLayout,
  withEnvironmentCodexHome,
} from "../provider/Drivers/CodexHomeLayout.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { FILE_CONVENTIONS, resolveInstructionFiles } from "./instructionFiles.ts";

const decodeClaudeSettings = Schema.decodeOption(ClaudeSettings);
const decodeCodexSettings = Schema.decodeOption(CodexSettings);

/** The folder an instance launches its provider with, resolved as its driver does. */
export const providerConfigDir = Effect.fn("InstructionFileAllowlist.providerConfigDir")(function* (
  driver: string,
  entry: ProviderInstanceConfig | undefined,
  home: string,
) {
  const path = yield* Path.Path;
  const env = yield* mergeProviderInstanceEnvironment(
    entry?.environment,
    yield* HostProcess.Environment,
  );
  if (driver === "claudeAgent") {
    const config = decodeClaudeSettings(entry?.config ?? {});
    return yield* resolveClaudeHomePath(
      { homePath: Option.isSome(config) ? config.value.homePath : "" },
      env,
    );
  }
  const config = Option.getOrUndefined(decodeCodexSettings(entry?.config ?? {}));
  if (config === undefined) return env.CODEX_HOME || path.join(home, ".codex");
  const layout = yield* resolveCodexHomeLayout(withEnvironmentCodexHome(config, env));
  return layout.effectiveHomePath ?? layout.sharedHomePath;
});

/**
 * Host files the Files tile may edit: `.md` files the Default view reads as instruction
 * files for a workspace under some configured provider instance. Nothing else outside
 * the workspace is writable.
 */
export class InstructionFileAllowlist extends Context.Service<
  InstructionFileAllowlist,
  {
    /** The real path to write, or null when `file` is not on the allowlist for `cwd`. */
    readonly editablePath: (cwd: string, file: string) => Effect.Effect<string | null>;
  }
>()("t3/threadInsights/InstructionFileAllowlist") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const isServerInternal = yield* makeIsServerInternalPath;

  return InstructionFileAllowlist.of({
    editablePath: Effect.fn("InstructionFileAllowlist.editablePath")(function* (cwd, file) {
      const realPath = yield* fs.realPath(file).pipe(Effect.orElseSucceed(() => null));
      if (realPath === null || !/\.md$/i.test(realPath) || !path.isAbsolute(cwd)) return null;
      const home = yield* HostProcess.HomeDirectory;
      const platform = yield* HostProcess.Platform;
      const configured = (yield* settings.getSettings.pipe(Effect.option)).pipe(
        Option.map((value) => value.providerInstances),
        Option.getOrElse(() => ({})),
      );
      // Built-in instances use their driver's name and need no settings entry.
      const instances = new Map<string, ProviderInstanceConfig | undefined>(
        Object.keys(FILE_CONVENTIONS).map((driver) => [driver, undefined]),
      );
      for (const [id, entry] of Object.entries(configured)) instances.set(id, entry);
      for (const [id, entry] of instances) {
        const driver = entry?.driver ?? id;
        const convention = FILE_CONVENTIONS[driver];
        if (convention === undefined) continue;
        const { files } = yield* resolveInstructionFiles(
          convention,
          cwd,
          {
            home,
            platform,
            configDir: yield* providerConfigDir(driver, entry, home).pipe(
              Effect.provideService(Path.Path, path),
            ),
          },
          (candidate) => isServerInternal(candidate).pipe(Effect.orElseSucceed(() => true)),
        ).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );
        if (files.some((found) => found.status === "expected" && found.realPath === realPath))
          return realPath;
      }
      return null;
    }),
  });
});

export const layer = Layer.effect(InstructionFileAllowlist, make);
