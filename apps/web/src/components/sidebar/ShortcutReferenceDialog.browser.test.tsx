import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  return {
    ...actual,
    primaryServerKeybindingsAtom: Atom.make(
      compileResolvedKeybindingsConfig([
        { key: "ctrl+alt+left", command: "workspace.tile.focusLeft" },
        { key: "ctrl+alt+h", command: "workspace.tile.focusLeft" },
        { key: "ctrl+shift+x", command: "workspace.tile.maximize" },
        { key: "mod+n", command: "chat.new" },
      ]),
    ),
  };
});

import { ShortcutReferenceDialog } from "./ShortcutReferenceDialog";

it("searches command names and configured keys while keeping aliases together", async () => {
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  const onOpenChange = vi.fn();
  // The reference reads keybindings directly and has no navigation.
  await using screen = await render(<ShortcutReferenceDialog open onOpenChange={onOpenChange} />, {
    router: false,
  });
  await expect.element(screen.getByRole("dialog", { name: "Shortcut reference" })).toBeVisible();
  await expect.element(screen.getByText("Ctrl+Alt+Left", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Ctrl+Alt+H", { exact: true })).toBeVisible();
  const search = screen.getByRole("textbox", { name: "Search shortcuts" });
  await userEvent.fill(search, "ctrl+shift+x");
  await expect.element(screen.getByText("Maximize Tile", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByText("Focus Tile Left", { exact: true }))
    .not.toBeInTheDocument();
  await userEvent.fill(search, "chat.new");
  await expect.element(screen.getByText("Chat: New", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("region", { name: "Workspace" })).not.toBeInTheDocument();
  await userEvent.fill(search, "no such shortcut");
  await expect.element(screen.getByText("No matching shortcuts.", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
});
