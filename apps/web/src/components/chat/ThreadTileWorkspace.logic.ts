import type { KeybindingCommand } from "@t3tools/contracts";
import type { RightPanelSurface } from "../../rightPanelStore";

export const TILE_AREAS = [
  { label: "Chat", key: "c" },
  { label: "Browser", key: "b" },
  { label: "Terminal", key: "t" },
  { label: "Files", key: "f" },
  { label: "Artifacts", key: "a" },
  { label: "Inspect", key: "i" },
  { label: "Notes", key: "n" },
  { label: "Diff", key: "d" },
  { label: "Pull request", key: "p" },
  { label: "Pull requests", key: "l" },
  { label: "Device", key: "v" },
  { label: "Side chat", key: "s" },
] as const;
export type TileAreaLabel = (typeof TILE_AREAS)[number]["label"];

/** Tile commands the command palette offers; each runs through the workspace's menu action. */
export const TILE_PALETTE_COMMANDS = [
  { command: "workspace.tile.maximize", title: "Maximize or Restore Tile" },
  { command: "workspace.tile.focusPair", title: "Show Tile Beside…" },
  { command: "workspace.tile.swap", title: "Swap Side-by-Side Tiles" },
  { command: "workspace.tile.float", title: "Float or Dock Tile" },
  { command: "workspace.tile.newTab", title: "New Tab in Tile" },
  { command: "workspace.tile.closeTab", title: "Close Tab in Tile" },
  { command: "workspace.tile.actions", title: "Tile Actions" },
] as const satisfies ReadonlyArray<{ command: KeybindingCommand; title: string }>;

/** What closing a whole tile asks first, or null when it can close at once. */
export function tileCloseConfirmation(input: {
  tabIds: readonly string[];
  surfaces: readonly RightPanelSurface[];
  runningTerminalIds: readonly string[];
  terminalLabelsById: ReadonlyMap<string, string>;
}): { title: string; description: string | null } | null {
  const running = input.surfaces
    .filter((surface) => input.tabIds.includes(surface.id))
    .flatMap((surface) => (surface.kind === "terminal" ? surface.terminalIds : []))
    .filter((terminalId) => input.runningTerminalIds.includes(terminalId))
    .map((terminalId) => input.terminalLabelsById.get(terminalId) ?? "A terminal process");
  const count = input.tabIds.length;
  const title = count > 1 ? `Close all ${count} tabs in this tile?` : "Close this tile?";
  if (running.length === 0) return count > 1 ? { title, description: null } : null;
  const names =
    running.length === 1
      ? running[0]!
      : `${running.slice(0, -1).join(", ")} and ${running.at(-1)!}`;
  return {
    title,
    description: `${names} ${running.length === 1 ? "is" : "are"} still running and will be stopped.`,
  };
}
