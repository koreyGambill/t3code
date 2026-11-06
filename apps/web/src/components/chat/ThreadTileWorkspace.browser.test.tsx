import "../../index.css";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import {
  selectThreadRightPanelState,
  selectThreadTileLayout,
  useRightPanelStore,
} from "../../rightPanelStore";
import { getTileGroups } from "../../threadTileLayout";
import { ThreadTileWorkspace } from "./ThreadTileWorkspace";

vi.mock("../RightPanelTabs", () => ({
  SurfaceIcon: () => null,
  surfaceTitle: (surface: { kind: string }) => surface.kind,
}));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

it("keeps conversation and editor contents mounted through grouping, splitting and maximizing", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1100, 800);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
  };

  const threadRef = {
    environmentId: EnvironmentId.make("tiles"),
    threadId: ThreadId.make("mount-preservation"),
  };
  useRightPanelStore.setState({ byThreadKey: {} });
  const store = useRightPanelStore.getState();
  store.open(threadRef, "files");
  store.open(threadRef, "inspect");
  const noop = () => {};
  function Harness() {
    const panel = useRightPanelStore((state) =>
      selectThreadRightPanelState(state.byThreadKey, threadRef),
    );
    return (
      <ThreadTileWorkspace
        threadRef={threadRef}
        header={null}
        conversation={<textarea aria-label="Conversation draft" defaultValue="" />}
        panels={{
          surfaces: panel.surfaces,
          activeSurfaceId: panel.activeSurfaceId,
          environmentId: threadRef.environmentId,
          keybindings: [],
          getShortcutContext: () => ({
            terminalFocus: false,
            terminalOpen: false,
            previewFocus: false,
            previewOpen: false,
            isWeb: true,
            isDesktop: false,
          }),
          pendingSurfaceIds: new Set(),
          previewSessions: {},
          desktopByTabId: {},
          terminalLabelsById: new Map(),
          onActivate: (surface) => store.activateSurface(threadRef, surface.id),
          onCloseSurface: (surface) => store.closeSurface(threadRef, surface.id),
          onCloseOtherSurfaces: noop,
          onCloseSurfacesToRight: noop,
          onCloseAllSurfaces: noop,
          onCopyFilePath: noop,
          onAddBrowser: noop,
          onAddBrowserInProfile: noop,
          onAddTerminal: () => store.openTerminal(threadRef, "new-terminal"),
          onAddDiff: noop,
          onAddFiles: noop,
          onAddNotes: () => store.open(threadRef, "notes"),
          onAddPullRequest: noop,
          onAddPullRequests: noop,
          onAddDevice: noop,
          browserAvailable: false,
          terminalAvailable: true,
          diffAvailable: false,
          filesAvailable: false,
          pullRequestAvailable: false,
          pullRequestsAvailable: false,
          deviceAvailable: false,
        }}
        renderSurface={(surface) => (
          <textarea aria-label={`Editor ${surface.id}`} defaultValue="" />
        )}
      />
    );
  }
  // The layout owns DOM placement and has no navigation.
  await using screen = await render(
    <div style={{ display: "flex", width: 900, height: 600 }}>
      <Harness />
    </div>,
    { router: false },
  );
  await userEvent.fill(
    screen.getByRole("textbox", { name: "Conversation draft" }),
    "unfinished conversation",
  );
  await userEvent.click(screen.getByRole("tab", { name: "files", exact: true }));
  await userEvent.fill(
    screen.getByRole("textbox", { name: "Editor files" }),
    "unsaved editor contents",
  );
  const layout = () => selectThreadTileLayout(useRightPanelStore.getState().byThreadKey, threadRef);
  const conversation = getTileGroups(layout()).find((group) =>
    group.tabs.includes("conversation"),
  )!;
  store.applyTileAction(threadRef, {
    type: "move",
    tabId: "files",
    targetGroupId: conversation.id,
  });
  await expect
    .element(screen.getByRole("textbox", { name: "Editor files" }))
    .toHaveValue("unsaved editor contents");
  store.applyTileAction(threadRef, {
    type: "split",
    tabId: "files",
    targetGroupId: conversation.id,
    axis: "vertical",
    side: "after",
    groupId: "editor-tile",
    splitId: "editor-split",
  });
  await expect
    .element(screen.getByRole("textbox", { name: "Editor files" }))
    .toHaveValue("unsaved editor contents");
  await expect
    .element(screen.getByRole("textbox", { name: "Conversation draft" }))
    .toHaveValue("unfinished conversation");
  store.applyTileAction(threadRef, { type: "maximize", groupId: "editor-tile" });
  await expect
    .element(screen.getByRole("textbox", { name: "Editor files" }))
    .toHaveValue("unsaved editor contents");
  await userEvent.click(
    screen.getByRole("button", { name: "Switch tile, 3 tiles, maximized", exact: true }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "1. Conversation", exact: true }));
  expect(layout().maximizedGroupId).toBe(conversation.id);
  await expect
    .element(screen.getByRole("textbox", { name: "Conversation draft" }))
    .toHaveValue("unfinished conversation");
  await userEvent.click(
    screen.getByRole("button", { name: "Switch tile, 3 tiles, maximized", exact: true }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Restore all tiles", exact: true }));
  expect(layout().maximizedGroupId).toBeNull();
  await expect
    .element(screen.getByRole("textbox", { name: "Conversation draft" }))
    .toHaveValue("unfinished conversation");
  await userEvent.click(
    screen.getByRole("button", { name: "New tile to the right", exact: true }).nth(0),
  );
  await expect.element(screen.getByText("Choose an area", { exact: true })).toBeVisible();
  const chooser = getTileGroups(layout()).find((group) => group.tabs.length === 0)!;
  expect(
    selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    ).surfaces.filter((surface) => surface.kind === "terminal"),
  ).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Terminal", exact: true }));
  expect(getTileGroups(layout()).find((group) => group.id === chooser.id)?.tabs).toContain(
    "terminal:new-terminal",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add area", exact: true }).nth(0));
  await expect
    .element(screen.getByRole("menuitem", { name: "Terminal", exact: true }))
    .toBeVisible();
  await userEvent.click(screen.getByRole("menuitem", { name: "Terminal", exact: true }));
  await expect
    .element(screen.getByRole("textbox", { name: "Editor terminal:new-terminal" }))
    .toBeVisible();
  // The region supplies coordinates; its floating content and drop overlay receive the drag.
  await userEvent.dragAndDrop(
    screen.getByRole("tab", { name: "files", exact: true }),
    screen.getByRole("region", { name: "Tile: inspect", exact: true }),
    { force: true },
  );
  await expect
    .element(screen.getByRole("textbox", { name: "Editor files" }))
    .toHaveValue("unsaved editor contents");
  expect(getTileGroups(layout()).find((group) => group.tabs.includes("files"))?.tabs).toContain(
    "inspect",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "New tile to the right", exact: true }).nth(0),
  );
  await expect.element(screen.getByText("Choose an area", { exact: true })).toBeVisible();
  const empty = getTileGroups(layout()).find((group) => group.tabs.length === 0)!;
  expect(empty).toBeDefined();
  expect(
    selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    ).surfaces.filter((surface) => surface.kind === "terminal"),
  ).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Close empty tile", exact: true }));
  expect(getTileGroups(layout()).some((group) => group.id === empty.id)).toBe(false);
  await userEvent.click(screen.getByRole("tab", { name: "Conversation", exact: true }));
  const movedGroup = getTileGroups(layout()).find((group) => group.tabs.includes("files"))!;
  const targetGroup = getTileGroups(layout()).find((group) => group.tabs.includes("conversation"))!;
  await userEvent.dragAndDrop(
    screen.getByRole("toolbar", { name: "Move tile: files", exact: true }),
    screen.getByRole("region", { name: "Tile: Conversation", exact: true }),
    { sourcePosition: { x: 5, y: 12 }, force: true },
  );
  expect(getTileGroups(layout()).findIndex((group) => group.id === movedGroup.id)).toBeLessThan(
    getTileGroups(layout()).findIndex((group) => group.id === targetGroup.id),
  );
  expect(getTileGroups(layout()).find((group) => group.id === movedGroup.id)?.colorIndex).toBe(
    movedGroup.colorIndex,
  );
  await expect
    .element(screen.getByRole("textbox", { name: "Editor files" }))
    .toHaveValue("unsaved editor contents");
  await userEvent.dragAndDrop(
    screen.getByRole("toolbar", { name: "Move tile: files", exact: true }),
    screen.getByRole("toolbar", { name: "Move tile: Conversation", exact: true }),
    { sourcePosition: { x: 5, y: 12 }, force: true },
  );
  expect(getTileGroups(layout()).find((group) => group.tabs.includes("files"))?.tabs).toContain(
    "conversation",
  );
  expect(getTileGroups(layout()).some((group) => group.id === movedGroup.id)).toBe(false);
  await userEvent.click(screen.getByRole("tab", { name: "files", exact: true }), {
    button: "middle",
  });
  await expect
    .element(screen.getByRole("tab", { name: "files", exact: true }))
    .not.toBeInTheDocument();
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces.some(
      (surface) => surface.id === "files",
    ),
  ).toBe(false);
  await userEvent.click(
    screen.getByRole("button", { name: "New tile to the right", exact: true }).nth(0),
  );
  const notesChooser = getTileGroups(layout()).find((group) => group.tabs.length === 0)!;
  await userEvent.click(screen.getByRole("button", { name: "Notes", exact: true }));
  await expect.element(screen.getByRole("tab", { name: "notes", exact: true })).toBeVisible();
  expect(getTileGroups(layout()).find((group) => group.id === notesChooser.id)?.tabs).toEqual([
    "notes",
  ]);
});
