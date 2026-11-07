import { dispatchMenuAction } from "../../shortcuts/dispatcher";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
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

async function setup(resizeScenario = false) {
  await using resources = new AsyncDisposableStack();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1100, 800);
  resources.defer(() => page.viewport(viewport.width, viewport.height));

  const threadRef = {
    environmentId: EnvironmentId.make("tiles"),
    threadId: ThreadId.make("mount-preservation"),
  };
  useRightPanelStore.setState({ byThreadKey: {} });
  const store = useRightPanelStore.getState();
  store.open(threadRef, "files");
  store.open(threadRef, "inspect");
  if (resizeScenario) {
    store.closeSurface(threadRef, "files");
    store.applyTileAction(threadRef, {
      type: "move",
      tabId: "inspect",
      targetGroupId: "conversation-group",
    });
    store.openTerminal(threadRef, "new-terminal");
    store.applyTileAction(threadRef, {
      type: "split",
      tabId: "terminal:new-terminal",
      targetGroupId: "conversation-group",
      axis: "horizontal",
      side: "after",
      groupId: "terminal-group",
      splitId: "terminal-split",
    });
  }
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
          keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
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
          onAddNotes: () => store.add(threadRef, "notes"),
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
          <textarea
            aria-label={surface.kind === "notes" ? "Editor notes" : `Editor ${surface.id}`}
            defaultValue=""
          />
        )}
      />
    );
  }
  // The layout owns DOM placement and has no navigation.
  const screen = resources.use(
    await render(
      <div style={{ display: "flex", width: 900, height: 600 }}>
        <Harness />
      </div>,
      { router: false },
    ),
  );
  const selectTab = async (name: string) => {
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (element) => element.getAttribute("aria-label") === name,
    )!;
    if (tab.getClientRects().length)
      await userEvent.click(screen.getByRole("tab", { name, exact: true }));
    else {
      const region = screen.getByRole("region", {
        name: tab.closest("section")!.getAttribute("aria-label")!,
        exact: true,
      });
      await userEvent.click(region.getByRole("button", { name: /^Tabs:/ }));
      await userEvent.click(screen.getByRole("menuitem", { name, exact: true }));
    }
  };
  const newTileRight = async () => {
    const section = document.querySelector<HTMLElement>("section.workspace-tile-frame")!;
    const region = screen.getByRole("region", {
      name: section.getAttribute("aria-label")!,
      exact: true,
    });
    const button = section.querySelector<HTMLElement>('[aria-label="New tile to the right"]')!;
    if (button.getClientRects().length)
      await userEvent.click(
        region.getByRole("button", { name: "New tile to the right", exact: true }),
      );
    else {
      await userEvent.click(region.getByRole("button", { name: "Tile actions", exact: true }));
      await userEvent.click(
        screen.getByRole("menuitem", { name: "New tile to the right", exact: true }),
      );
    }
  };
  const layout = () => selectThreadTileLayout(useRightPanelStore.getState().byThreadKey, threadRef);
  const owned = resources.move();
  return {
    screen,
    store,
    threadRef,
    layout,
    selectTab,
    newTileRight,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

it("keeps conversation and editor contents mounted through grouping, splitting and maximizing", async () => {
  await using fixture = await setup();
  const { screen, store, threadRef, layout, selectTab, newTileRight } = fixture;
  await userEvent.fill(
    screen.getByRole("textbox", { name: "Conversation draft" }),
    "unfinished conversation",
  );
  await selectTab("files");
  await userEvent.fill(
    screen.getByRole("textbox", { name: "Editor files" }),
    "unsaved editor contents",
  );
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
  await newTileRight();
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
  const tabGroupId = layout().focusedGroupId;
  await userEvent.keyboard("{Control>}{Tab}{/Control}");
  expect(getTileGroups(layout()).find((group) => group.id === tabGroupId)?.activeTabId).toBe(
    "inspect",
  );
  await userEvent.keyboard("{Control>}{Shift>}{Tab}{/Shift}{/Control}");
  expect(getTileGroups(layout()).find((group) => group.id === tabGroupId)?.activeTabId).toBe(
    "files",
  );
  await newTileRight();
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
  await selectTab("Conversation");
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
});

it("resizes, focuses any two tabs and opens independent area views", async () => {
  await using fixture = await setup(true);
  const { screen, store, threadRef, layout, selectTab, newTileRight } = fixture;
  await newTileRight();
  const notesChooser = getTileGroups(layout()).find((group) => group.tabs.length === 0)!;
  await userEvent.click(screen.getByRole("button", { name: "Notes", exact: true }));
  await expect
    .element(screen.getByRole("textbox", { name: "Editor notes", exact: true }))
    .toBeVisible();
  const notesId = getTileGroups(layout()).find((group) => group.id === notesChooser.id)!.tabs[0]!;
  expect(notesId).toMatch(/^notes:/);
  const notesRect = screen
    .getByRole("textbox", { name: "Editor notes" })
    .element()
    .getBoundingClientRect();
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: notesRect.x + notesRect.width / 2,
      clientY: notesRect.y + notesRect.height / 2,
    }),
  );
  const beforeResize = JSON.stringify(layout().root);
  await userEvent.keyboard("{Control>}{Alt>}{r>}");
  await expect.element(screen.getByRole("status", { name: "Resizing focused tile" })).toBeVisible();
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: notesRect.x + notesRect.width / 2 + 60,
      clientY: notesRect.y + notesRect.height / 2 + 30,
    }),
  );
  expect(JSON.stringify(layout().root)).toBe(beforeResize);
  await userEvent.keyboard("{/r}{/Alt}{/Control}");
  expect(JSON.stringify(layout().root)).not.toBe(beforeResize);
  const committed = JSON.stringify(layout().root);
  await userEvent.keyboard("{Control>}{Alt>}{r>}");
  await expect.element(screen.getByRole("status", { name: "Resizing focused tile" })).toBeVisible();
  await userEvent.keyboard("{ArrowRight}{Escape}{/r}{/Alt}{/Control}");
  expect(JSON.stringify(layout().root)).toBe(committed);
  const focusedBefore = layout().focusedGroupId;
  await userEvent.keyboard("{Control>}{Alt>}h{/Alt}{/Control}");
  expect(layout().focusedGroupId).not.toBe(focusedBefore);
  store.applyTileAction(threadRef, { type: "focus", groupId: notesChooser.id });
  const fullTree = JSON.stringify(layout().root);
  await userEvent.keyboard("{Control>}{Alt>}f{/Alt}{/Control}");
  expect(layout().focusPairGroupId).toBe(notesChooser.id);
  await expect
    .element(screen.getByRole("button", { name: "Choose tile: terminal", exact: true }))
    .toBeVisible();
  const notesElement = screen.getByRole("textbox", { name: "Editor notes" }).element();
  await expect.element(screen.getByRole("textbox", { name: "Conversation draft" })).toBeVisible();
  await userEvent.keyboard("{Control>}{Alt>}{ArrowLeft}{/Alt}{/Control}");
  expect(layout().focusPairLeftTabId).toBeTruthy();
  expect(layout().focusPairRightTabId).toBe(notesId);
  await userEvent.click(screen.getByRole("button", { name: "Choose left tab", exact: true }));
  const chooseTerminal = screen.getByRole("button", { name: "Choose tile: terminal", exact: true });
  const guestRect = chooseTerminal.element().getBoundingClientRect();
  const hostedGuest = document.createElement("button");
  Object.assign(hostedGuest.style, {
    position: "fixed",
    zIndex: "30",
    left: `${guestRect.x}px`,
    top: `${guestRect.y}px`,
    width: `${guestRect.width}px`,
    height: `${guestRect.height}px`,
  });
  let pageClicks = 0;
  hostedGuest.onclick = () => {
    pageClicks++;
  };
  document.body.append(hostedGuest);
  using _hostedGuest = { [Symbol.dispose]: () => hostedGuest.remove() };
  expect(
    document.elementFromPoint(
      guestRect.x + guestRect.width / 2,
      guestRect.y + guestRect.height / 2,
    ),
  ).toBe(chooseTerminal.element());
  await userEvent.click(chooseTerminal);
  expect(pageClicks).toBe(0);
  hostedGuest.remove();
  expect(layout().focusPairLeftTabId).toBe("terminal:new-terminal");
  await userEvent.click(screen.getByRole("button", { name: "Choose left tab", exact: true }));
  await userEvent.keyboard("{Escape}");
  expect(layout().focusPairGroupId).toBeNull();
  expect(JSON.stringify(layout().root)).toBe(fullTree);
  await userEvent.keyboard("{Control>}{Alt>}f{/Alt}{/Control}");
  screen.getByRole("button", { name: "Show inspect on left", exact: true }).element().focus();
  await userEvent.keyboard("{Enter}");
  expect(layout().focusPairLeftTabId).toBe("inspect");
  expect(screen.getByRole("textbox", { name: "Editor notes" }).element()).toBe(notesElement);
  expect(JSON.stringify(layout().root)).toBe(fullTree);
  await expect.element(screen.getByRole("textbox", { name: "Editor notes" })).toBeVisible();
  expect(document.querySelectorAll("section.workspace-tile-frame")).toHaveLength(2);
  await userEvent.keyboard("{Control>}{Alt>}{Enter}{/Alt}{/Control}");
  expect(document.querySelectorAll("section.workspace-tile-frame")).toHaveLength(1);
  await userEvent.keyboard("{Control>}{Alt>}{Enter}{/Alt}{/Control}");
  expect(document.querySelectorAll("section.workspace-tile-frame")).toHaveLength(2);
  const pairRect = screen
    .getByRole("textbox", { name: "Editor notes" })
    .element()
    .getBoundingClientRect();
  window.dispatchEvent(
    new PointerEvent("pointermove", { clientX: pairRect.x + 30, clientY: pairRect.y + 30 }),
  );
  await userEvent.keyboard("{Control>}{Alt>}{r>}");
  await expect.element(screen.getByRole("status", { name: "Resizing focused tile" })).toBeVisible();
  window.dispatchEvent(
    new PointerEvent("pointermove", { clientX: pairRect.x + 90, clientY: pairRect.y + 30 }),
  );
  await userEvent.keyboard("{/r}{/Alt}{/Control}");
  expect(layout().focusPairRatio).not.toBe(0.55);
  expect(JSON.stringify(layout().root)).toBe(fullTree);
  await userEvent.keyboard("{Control>}{Alt>}f{/Alt}{/Control}");
  expect(layout().focusPairGroupId).toBeNull();
  expect(document.querySelectorAll("section.workspace-tile-frame")).toHaveLength(3);
  expect(JSON.stringify(layout().root)).toBe(fullTree);

  await selectTab("Conversation");
  const beforeSameGroupFocus = JSON.stringify(layout().root);
  const wrapper = document.querySelector<HTMLElement>("[data-thread-tiling]")!.parentElement!;
  wrapper.style.width = "520px";
  await userEvent.keyboard("{Control>}{Alt>}f{/Alt}{/Control}");
  await userEvent.click(screen.getByRole("button", { name: "Show inspect on left", exact: true }));
  await expect.element(screen.getByRole("textbox", { name: "Conversation draft" })).toBeVisible();
  await expect.element(screen.getByRole("textbox", { name: "Editor inspect" })).toBeVisible();
  await userEvent.click(screen.getByRole("textbox", { name: "Editor inspect" }));
  expect(layout().focusPairRightTabId).toBe("conversation");
  expect(layout().focusPairLeftTabId).toBe("inspect");
  await userEvent.keyboard("{Control>}{Alt>}{Enter}{/Alt}{/Control}");
  await expect.element(screen.getByRole("textbox", { name: "Editor inspect" })).toBeVisible();
  await userEvent.keyboard("{Control>}{Alt>}{Enter}{/Alt}{/Control}");
  await expect.element(screen.getByRole("textbox", { name: "Conversation draft" })).toBeVisible();
  await userEvent.keyboard("{Control>}{Alt>}f{/Alt}{/Control}");
  expect(JSON.stringify(layout().root)).toBe(beforeSameGroupFocus);
  wrapper.style.width = "900px";

  const beforeNativeResize = JSON.stringify(layout().root);
  dispatchMenuAction("workspace.tile.resize");
  await expect.element(screen.getByRole("status", { name: "Resizing focused tile" })).toBeVisible();
  await userEvent.keyboard("{Control>}{Alt>}{ArrowLeft}");
  await expect.element(screen.getByRole("status", { name: "Resizing focused tile" })).toBeVisible();
  window.dispatchEvent(
    new KeyboardEvent("keyup", { key: "r", code: "KeyR", ctrlKey: true, altKey: true }),
  );
  await userEvent.keyboard("{/Alt}{/Control}");
  expect(JSON.stringify(layout().root)).not.toBe(beforeNativeResize);
  await newTileRight();
  const secondNotesGroup = getTileGroups(layout()).find((group) => group.tabs.length === 0)!;
  await userEvent.click(screen.getByRole("button", { name: "Notes", exact: true }));
  expect(
    selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    ).surfaces.filter((surface) => surface.kind === "notes"),
  ).toHaveLength(2);
  const secondNotesId = getTileGroups(layout()).find((group) => group.id === secondNotesGroup.id)!
    .tabs[0]!;
  expect(secondNotesId).not.toBe(notesId);
  expect(getTileGroups(layout()).find((group) => group.id === notesChooser.id)?.tabs).toContain(
    notesId,
  );
  const notesGroups = getTileGroups(layout()).filter((group) =>
    group.tabs.some((tabId) => tabId.startsWith("notes:")),
  );
  await userEvent.click(
    screen
      .getByRole("region", { name: "Tile: notes", exact: true })
      .nth(notesGroups.findIndex((group) => group.id === secondNotesGroup.id))
      .getByRole("button", { name: "Tile actions", exact: true }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Close tab", exact: true }));
  expect(
    selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    ).surfaces.filter((surface) => surface.kind === "notes"),
  ).toHaveLength(1);
});
