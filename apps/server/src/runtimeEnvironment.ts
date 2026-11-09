/** Server ports and runtime settings belong to this server, not tools it launches. */
export function isServerRuntimeEnvKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return (
    normalized.startsWith("T3CODE_") ||
    normalized.startsWith("VITE_") ||
    normalized === "PORT" ||
    normalized === "ELECTRON_RENDERER_PORT" ||
    normalized === "ELECTRON_RUN_AS_NODE"
  );
}
