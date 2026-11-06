import {
  registerCommands,
  registerMenuAction,
  type CommandHandlers,
} from "../../shortcuts/dispatcher";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Columns2,
  Rows2,
  Maximize2,
  Minimize2,
  MessagesSquare,
  Plus,
  CircleHelp,
  GripVertical,
  X,
} from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  useRightPanelStore,
  selectThreadTileLayout,
  type RightPanelSurface,
} from "../../rightPanelStore";
import {
  applyTileAction as reduceTileAction,
  CONVERSATION_TAB_ID,
  getTileGroups,
  type TileGroup,
} from "../../threadTileLayout";
import { directionalTile, tileGeometry, type TileRect } from "../../threadTileGeometry";
import { useTheme } from "../../hooks/useTheme";
import { SurfaceIcon, surfaceTitle, type RightPanelTabsProps } from "../RightPanelTabs";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PanelTabCloseButton } from "../ui/panel-tab-close-button";
import { cn, randomUUID } from "../../lib/utils";

const TAB_DRAG_TYPE = "application/x-weavewing-tab";
const GROUP_DRAG_TYPE = "application/x-weavewing-group";
type DropZone = "tabs" | "center" | "left" | "right" | "top" | "bottom";
type TileDrop = { groupId: string; zone: DropZone };
type TileDrag = { kind: "tab" | "group"; id: string };
type PanelActions = Omit<RightPanelTabsProps, "children" | "mode" | "inlineSize">;
const rectStyle = (rect: TileRect): CSSProperties => ({
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
  height: `${rect.height * 100}%`,
});

export function ThreadTileWorkspace(props: {
  threadRef: ScopedThreadRef;
  header: ReactNode;
  conversation: ReactNode;
  conversationControls?: ReactNode;
  conversationHeaderRef?: (node: HTMLDivElement | null) => void;
  panels: PanelActions;
  renderSurface: (
    surface: RightPanelSurface,
    visible: boolean,
    layoutVersion: string,
    focused: boolean,
  ) => ReactNode;
}) {
  const savedLayout = useRightPanelStore((state) =>
    selectThreadTileLayout(state.byThreadKey, props.threadRef),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<TileDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<TileDrop | null>(null);
  const headerDragBlocked = useRef(false);
  const [resizing, setResizing] = useState(false);
  const [resizeOverride, setResizeOverride] = useState<{ splitId: string; ratio: number } | null>(
    null,
  );
  const layout = resizeOverride
    ? reduceTileAction(savedLayout, { type: "resize", ...resizeOverride })
    : savedLayout;
  const { resolvedTheme } = useTheme();
  const groups = getTileGroups(layout);
  const geometry = tileGeometry(layout.root);
  const maximized = layout.maximizedGroupId;
  const visibleGroups = maximized
    ? geometry.groups
        .filter((group) => group.id === maximized)
        .map((group) => ({ ...group, rect: { x: 0, y: 0, width: 1, height: 1 } }))
    : geometry.groups;
  const visibleTabIds = groups
    .filter((group) => visibleGroups.some((entry) => entry.id === group.id))
    .map((group) => group.activeTabId);
  const [mountedTabIds, setMountedTabIds] = useState<string[]>([]);
  const validIds = new Set<string>(props.panels.surfaces.map((surface) => surface.id));
  const mounted = [
    ...new Set([
      ...mountedTabIds.filter((id) => validIds.has(id)),
      ...visibleTabIds.filter((id) => id && id !== CONVERSATION_TAB_ID),
    ]),
  ];
  if (
    mounted.length !== mountedTabIds.length ||
    mounted.some((id, index) => id !== mountedTabIds[index])
  )
    setMountedTabIds(mounted);
  const layoutVersion = JSON.stringify(layout);
  const apply = (
    action: Parameters<ReturnType<typeof useRightPanelStore.getState>["applyTileAction"]>[1],
  ) => useRightPanelStore.getState().applyTileAction(props.threadRef, action);
  const title = (id: string) => {
    if (id === CONVERSATION_TAB_ID) return "Conversation";
    const surface = props.panels.surfaces.find((entry) => entry.id === id);
    return surface
      ? surfaceTitle(surface, props.panels.previewSessions, props.panels.terminalLabelsById)
      : "Choose area";
  };
  const activate = (group: TileGroup, tabId: string) => {
    apply({ type: "activate", groupId: group.id, tabId });
    const surface = props.panels.surfaces.find((entry) => entry.id === tabId);
    if (surface) props.panels.onActivate(surface);
  };
  const split = (group: TileGroup, axis: "horizontal" | "vertical") => {
    apply({
      type: "new-group",
      targetGroupId: group.id,
      axis,
      side: "after",
      groupId: randomUUID(),
      splitId: randomUUID(),
    });
  };
  const focus = (groupId: string) => {
    const current = selectThreadTileLayout(
      useRightPanelStore.getState().byThreadKey,
      props.threadRef,
    );
    const group = getTileGroups(current).find((entry) => entry.id === groupId);
    if (!group) return;
    if (group.tabs.length === 0) {
      apply({ type: "focus", groupId });
      return;
    }
    activate(group, group.activeTabId);
    const surface = props.panels.surfaces.find((entry) => entry.id === group.activeTabId);
    if (surface?.kind === "terminal") return;
    requestAnimationFrame(() => {
      const content = rootRef.current?.querySelector<HTMLElement>(
        `[data-tile-content="${CSS.escape(group.activeTabId)}"]`,
      );
      if (!content || content.contains(document.activeElement)) return;
      const target =
        group.activeTabId === CONVERSATION_TAB_ID || surface?.kind === "preview"
          ? (content.querySelector<HTMLElement>(
              '[contenteditable="true"], textarea, [role="textbox"]',
            ) ?? content)
          : content;
      target.focus({ preventScroll: true });
    });
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers workspace commands and native browser menu actions for this mounted thread
  useEffect(() => {
    const currentLayout = () =>
      selectThreadTileLayout(useRightPanelStore.getState().byThreadKey, props.threadRef);
    const currentGroup = () => {
      const current = currentLayout();
      return getTileGroups(current).find((entry) => entry.id === current.focusedGroupId);
    };
    const moveFocus = (direction: "left" | "right" | "up" | "down") => {
      const group = currentGroup();
      if (!group) return;
      const next = directionalTile(tileGeometry(currentLayout().root).groups, group.id, direction);
      if (next) focus(next);
    };
    const moveTab = (direction: "left" | "right" | "up" | "down") => {
      const group = currentGroup();
      if (!group) return;
      apply({
        type: "split",
        tabId: group.activeTabId,
        targetGroupId: group.id,
        axis: direction === "left" || direction === "right" ? "horizontal" : "vertical",
        side: direction === "left" || direction === "up" ? "before" : "after",
        groupId: randomUUID(),
        splitId: randomUUID(),
      });
    };
    const nextTab = (offset: number) => {
      const group = currentGroup();
      if (group && group.tabs.length > 0)
        activate(
          group,
          group.tabs[
            (group.tabs.indexOf(group.activeTabId) + offset + group.tabs.length) % group.tabs.length
          ]!,
        );
    };
    const actions = {
      "workspace.tile.focusLeft": () => moveFocus("left"),
      "workspace.tile.focusRight": () => moveFocus("right"),
      "workspace.tile.focusUp": () => moveFocus("up"),
      "workspace.tile.focusDown": () => moveFocus("down"),
      "workspace.tile.splitLeft": () => moveTab("left"),
      "workspace.tile.splitRight": () => moveTab("right"),
      "workspace.tile.splitUp": () => moveTab("up"),
      "workspace.tile.splitDown": () => moveTab("down"),
      "workspace.tile.maximize": () => {
        const current = currentLayout();
        apply({
          type: "maximize",
          groupId: current.maximizedGroupId ? null : current.focusedGroupId,
        });
      },
      "workspace.tile.previousTab": () => nextTab(-1),
      "workspace.tile.nextTab": () => nextTab(1),
    };
    const commands: CommandHandlers = Object.fromEntries(
      Object.entries(actions).map(([command, run]) => [
        command,
        (event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();
          run();
        },
      ]),
    );
    const disposers = [
      registerCommands(commands, {
        capture: true,
        keybindings: () => props.panels.keybindings,
        context: props.panels.getShortcutContext,
        when: (event) =>
          !event.isComposing &&
          !(
            event.target instanceof Element &&
            event.target.closest('[role="dialog"], [role="alertdialog"], [data-keybinding-capture]')
          ),
      }),
      ...Object.entries(actions).map(([command, run]) => registerMenuAction(command, run)),
    ];
    for (const surface of props.panels.surfaces) {
      if (surface.kind !== "preview" || !surface.resourceId) continue;
      const nativeId = props.panels.previewRuntimeTabId?.(surface.resourceId) ?? surface.resourceId;
      disposers.push(
        registerMenuAction(`workspace.tile.browserFocused:${nativeId}`, () => {
          const owner = groups.find((group) => group.tabs.includes(surface.id));
          if (owner) activate(owner, surface.id);
        }),
      );
    }
    return () => {
      for (const dispose of disposers) dispose();
    };
  });

  const resize = (
    event: ReactPointerEvent<HTMLDivElement>,
    line: (typeof geometry.splits)[number],
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;
    handle.setPointerCapture(event.pointerId);
    setResizing(true);
    let latestRatio = line.ratio;
    const move = (next: PointerEvent) => {
      const coordinate =
        line.axis === "horizontal"
          ? (next.clientX - bounds.left) / bounds.width
          : (next.clientY - bounds.top) / bounds.height;
      const start = line.axis === "horizontal" ? line.rect.x : line.rect.y;
      const size = line.axis === "horizontal" ? line.rect.width : line.rect.height;
      latestRatio = Math.max(0.12, Math.min(0.88, (coordinate - start) / size));
      setResizeOverride({ splitId: line.id, ratio: latestRatio });
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("lostpointercapture", stop);
      apply({ type: "resize", splitId: line.id, ratio: latestRatio });
      setResizeOverride(null);
      setResizing(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop, { once: true });
    handle.addEventListener("lostpointercapture", stop, { once: true });
  };
  const addChoices = [
    { label: "Browser", enabled: props.panels.browserAvailable, run: props.panels.onAddBrowser },
    { label: "Terminal", enabled: props.panels.terminalAvailable, run: props.panels.onAddTerminal },
    { label: "Files", enabled: props.panels.filesAvailable, run: props.panels.onAddFiles },
    {
      label: "Workspace",
      enabled: Boolean(props.panels.onAddReviews),
      run: props.panels.onAddReviews,
    },
    {
      label: "Inspect",
      enabled: Boolean(props.panels.onAddInspect),
      run: props.panels.onAddInspect,
    },
    { label: "Notes", enabled: Boolean(props.panels.onAddNotes), run: props.panels.onAddNotes },
    { label: "Diff", enabled: props.panels.diffAvailable, run: props.panels.onAddDiff },
    {
      label: "Pull request",
      enabled: props.panels.pullRequestAvailable,
      run: props.panels.onAddPullRequest,
    },
    {
      label: "Pull requests",
      enabled: props.panels.pullRequestsAvailable,
      run: props.panels.onAddPullRequests,
    },
    { label: "Device", enabled: props.panels.deviceAvailable, run: props.panels.onAddDevice },
    {
      label: "Side chat",
      enabled: props.panels.sideChatAvailable === true,
      run: props.panels.onAddSideChat,
    },
  ];
  const locateDrop = (event: ReactDragEvent): TileDrop | null => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return null;
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const hovered = visibleGroups.find(
      ({ rect }) =>
        x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
    );
    if (!hovered) return null;
    const localX = (x - hovered.rect.x) / hovered.rect.width;
    const localY = (y - hovered.rect.y) / hovered.rect.height;
    if ((y - hovered.rect.y) * bounds.height <= 32) return { groupId: hovered.id, zone: "tabs" };
    const edges = [
      { zone: "left" as const, distance: localX },
      { zone: "right" as const, distance: 1 - localX },
      { zone: "top" as const, distance: localY },
      { zone: "bottom" as const, distance: 1 - localY },
    ];
    const nearest = edges.reduce((a, b) => (a.distance < b.distance ? a : b));
    return { groupId: hovered.id, zone: nearest.distance < 0.22 ? nearest.zone : "center" };
  };
  const dropRect = dropTarget
    ? visibleGroups.find((group) => group.id === dropTarget.groupId)?.rect
    : undefined;
  const dropStyle: CSSProperties | undefined =
    dropRect && dropTarget
      ? {
          ...rectStyle({
            x: dropRect.x + (dropTarget.zone === "right" ? dropRect.width / 2 : 0),
            y: dropRect.y + (dropTarget.zone === "bottom" ? dropRect.height / 2 : 0),
            width:
              dropRect.width *
              (dropTarget.zone === "left" || dropTarget.zone === "right" ? 0.5 : 1),
            height:
              dropRect.height *
              (dropTarget.zone === "top" || dropTarget.zone === "bottom" ? 0.5 : 1),
          }),
          ...(dropTarget.zone === "tabs" ? { height: "var(--tile-titlebar-height)" } : {}),
        }
      : undefined;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-thread-tiling>
      {props.header}
      <div
        ref={rootRef}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-border/40"
        onDragOverCapture={(event) => {
          if (!dragging) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const next = locateDrop(event);
          setDropTarget((current) =>
            current?.groupId === next?.groupId && current?.zone === next?.zone ? current : next,
          );
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setDropTarget(null);
        }}
        onDropCapture={(event) => {
          if (!dragging) return;
          event.preventDefault();
          event.stopPropagation();
          const target = locateDrop(event);
          if (target) {
            const { groupId: targetGroupId, zone } = target;
            const edge = zone !== "center" && zone !== "tabs";
            if (dragging.kind === "group") {
              if (edge)
                apply({
                  type: "dock-group",
                  groupId: dragging.id,
                  targetGroupId,
                  axis: zone === "left" || zone === "right" ? "horizontal" : "vertical",
                  side: zone === "left" || zone === "top" ? "before" : "after",
                  splitId: randomUUID(),
                });
              else if (zone === "tabs")
                apply({ type: "merge-groups", groupId: dragging.id, targetGroupId });
              else
                apply({
                  type: "swap-groups",
                  firstGroupId: dragging.id,
                  secondGroupId: targetGroupId,
                });
            } else if (edge)
              apply({
                type: "split",
                tabId: dragging.id,
                targetGroupId,
                axis: zone === "left" || zone === "right" ? "horizontal" : "vertical",
                side: zone === "left" || zone === "top" ? "before" : "after",
                groupId: randomUUID(),
                splitId: randomUUID(),
              });
            else {
              const tabElement =
                event.target instanceof Element
                  ? event.target.closest<HTMLElement>("[data-tab-id]")
                  : null;
              const targetGroup = groups.find((group) => group.id === targetGroupId);
              const index = tabElement?.dataset.tabId
                ? targetGroup?.tabs.indexOf(tabElement.dataset.tabId)
                : undefined;
              apply({
                type: "move",
                tabId: dragging.id,
                targetGroupId,
                ...(index !== undefined ? { index } : {}),
              });
            }
          }
          setDragging(null);
          setDropTarget(null);
        }}
      >
        {visibleGroups.map(({ id, rect }) => {
          const group = groups.find((entry) => entry.id === id)!;
          return (
            <section
              key={id}
              style={
                {
                  ...rectStyle(rect),
                  "--tile-group-accent": `var(--tile-accent-${group.colorIndex ?? 0})`,
                } as CSSProperties
              }
              className="workspace-tile-frame absolute overflow-hidden bg-background"
              data-focused={layout.focusedGroupId === id}
              aria-label={`Tile: ${title(group.activeTabId)}`}
            >
              <div
                className="workspace-tile-titlebar flex min-w-0 cursor-grab items-center gap-0.5 px-1 active:cursor-grabbing"
                ref={
                  group.tabs.includes(CONVERSATION_TAB_ID) ? props.conversationHeaderRef : undefined
                }
                role="toolbar"
                aria-label={`Move tile: ${title(group.activeTabId)}`}
                draggable
                onPointerDownCapture={(event) => {
                  headerDragBlocked.current =
                    event.target instanceof Element &&
                    Boolean(event.target.closest("button, a, input, [role=tab]"));
                }}
                onPointerDown={() => apply({ type: "focus", groupId: id })}
                onDragStart={(event) => {
                  if (headerDragBlocked.current) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.setData(GROUP_DRAG_TYPE, id);
                  event.dataTransfer.effectAllowed = "move";
                  setDragging({ kind: "group", id });
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
              >
                <GripVertical aria-hidden className="workspace-tile-grip size-3 shrink-0" />
                <div
                  className="flex min-w-0 flex-1 items-center overflow-x-auto"
                  role="tablist"
                  aria-label="Tile tabs"
                >
                  {group.tabs.map((tabId) => {
                    const surface = props.panels.surfaces.find((entry) => entry.id === tabId);
                    const session =
                      surface?.kind === "preview" && surface.resourceId
                        ? props.panels.previewSessions[surface.resourceId]
                        : null;
                    const previewUrl =
                      session && session.navStatus._tag !== "Idle" ? session.navStatus.url : null;
                    return (
                      <div
                        key={tabId}
                        className="workspace-tile-tab flex shrink-0 items-center rounded-sm"
                        data-active={group.activeTabId === tabId}
                      >
                        <button
                          type="button"
                          role="tab"
                          data-tab-id={tabId}
                          aria-selected={group.activeTabId === tabId}
                          aria-label={title(tabId)}
                          className="flex max-w-44 min-w-0 cursor-pointer items-center gap-1.5 px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                          draggable
                          onDragStart={(event) => {
                            event.stopPropagation();
                            event.dataTransfer.setData(TAB_DRAG_TYPE, tabId);
                            event.dataTransfer.effectAllowed = "move";
                            setDragging({ kind: "tab", id: tabId });
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(null);
                          }}
                          onMouseDown={(event) => {
                            if (event.button === 1) event.preventDefault();
                          }}
                          onAuxClick={(event) => {
                            if (event.button !== 1) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (surface) props.panels.onCloseSurface(surface);
                          }}
                          onClick={() => activate(group, tabId)}
                        >
                          {surface ? (
                            <SurfaceIcon
                              surface={surface}
                              previewUrl={previewUrl}
                              previewCapturedUrl={null}
                              theme={resolvedTheme}
                              environmentId={props.threadRef.environmentId}
                              pullRequestStatusSeed={undefined}
                            />
                          ) : (
                            <MessagesSquare className="size-3 shrink-0" />
                          )}
                          <span className="truncate">{title(tabId)}</span>
                        </button>
                        {surface ? (
                          <PanelTabCloseButton
                            label={`Close ${title(tabId)}`}
                            onClick={() => props.panels.onCloseSurface(surface)}
                          >
                            <X className="size-3" />
                          </PanelTabCloseButton>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {group.activeTabId === CONVERSATION_TAB_ID ? props.conversationControls : null}
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        size="micro"
                        variant={maximized ? "secondary" : "ghost-muted"}
                        aria-label={`Switch tile, ${groups.length} tiles${maximized ? ", maximized" : ""}`}
                      />
                    }
                  >
                    <Columns2 className="size-3" />
                    {maximized
                      ? `${groups.findIndex((entry) => entry.id === id) + 1}/${groups.length} · Maximized`
                      : `${groups.length} ${groups.length === 1 ? "tile" : "tiles"}`}
                  </MenuTrigger>
                  <MenuPopup align="end">
                    {groups.map((entry, index) => (
                      <MenuItem
                        key={entry.id}
                        onClick={() => {
                          focus(entry.id);
                          if (maximized) apply({ type: "maximize", groupId: entry.id });
                        }}
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: `var(--tile-accent-${entry.colorIndex ?? 0})` }}
                        />
                        {index + 1}. {title(entry.activeTabId)}
                      </MenuItem>
                    ))}
                    {maximized && (
                      <MenuItem onClick={() => apply({ type: "maximize", groupId: null })}>
                        Restore all tiles
                      </MenuItem>
                    )}
                  </MenuPopup>
                </Menu>
                <TileControl
                  label="New tile to the right"
                  onClick={() => split(group, "horizontal")}
                >
                  <Columns2 />
                </TileControl>
                <TileControl label="New tile below" onClick={() => split(group, "vertical")}>
                  <Rows2 />
                </TileControl>
                <TileControl
                  label={
                    maximized ? "Restore tiles (Ctrl+Alt+Enter)" : "Maximize tile (Ctrl+Alt+Enter)"
                  }
                  onClick={() => apply({ type: "maximize", groupId: maximized ? null : id })}
                >
                  {maximized ? <Minimize2 /> : <Maximize2 />}
                </TileControl>
                {group.tabs.length === 0 && (
                  <TileControl
                    label="Close empty tile"
                    onClick={() => apply({ type: "close-group", groupId: id })}
                  >
                    <X />
                  </TileControl>
                )}
                <Menu>
                  <MenuTrigger
                    render={<Button size="icon-micro" variant="ghost" aria-label="Add area" />}
                  >
                    <Plus className="size-3" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    {addChoices
                      .filter((choice) => choice.enabled)
                      .map((choice) => (
                        <MenuItem
                          key={choice.label}
                          onClick={() => {
                            apply({ type: "focus", groupId: id });
                            choice.run?.();
                          }}
                        >
                          {choice.label}
                        </MenuItem>
                      ))}
                    <MenuItem
                      onClick={() =>
                        activate(
                          groups.find((entry) => entry.tabs.includes(CONVERSATION_TAB_ID))!,
                          CONVERSATION_TAB_ID,
                        )
                      }
                    >
                      Conversation
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
              {group.tabs.length === 0 && (
                <div
                  className="flex h-full flex-col items-center justify-center gap-4 p-6"
                  onPointerDown={() => apply({ type: "focus", groupId: id })}
                >
                  <p className="text-sm font-medium">Choose an area</p>
                  <div className="flex max-w-sm flex-wrap justify-center gap-2">
                    {addChoices
                      .filter((choice) => choice.enabled)
                      .map((choice) => (
                        <Button
                          key={choice.label}
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            apply({ type: "focus", groupId: id });
                            choice.run?.();
                          }}
                        >
                          {choice.label}
                        </Button>
                      ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
        {[
          CONVERSATION_TAB_ID,
          ...props.panels.surfaces
            .filter((surface) => mounted.includes(surface.id))
            .map((surface) => surface.id),
        ].map((tabId) => {
          const group = groups.find((entry) => entry.tabs.includes(tabId));
          const placed = visibleGroups.find((entry) => entry.id === group?.id);
          const visible = Boolean(placed && group?.activeTabId === tabId);
          const rect = placed?.rect ?? { x: 0, y: 0, width: 1, height: 1 };
          const surface = props.panels.surfaces.find((entry) => entry.id === tabId);
          const contentVisible =
            visible && !(surface?.kind === "preview" && (dragging !== null || resizing));
          return (
            <div
              key={tabId}
              data-tile-content={tabId}
              tabIndex={-1}
              inert={!visible}
              className="absolute z-10 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background outline-none"
              hidden={!visible}
              style={{
                ...rectStyle(rect),
                left: `calc(${rect.x * 100}% + var(--tile-border-width))`,
                width: `calc(${rect.width * 100}% - 2 * var(--tile-border-width))`,
                top: `calc(${rect.y * 100}% + var(--tile-titlebar-height))`,
                height: `calc(${rect.height * 100}% - var(--tile-titlebar-height) - var(--tile-border-width))`,
                display: visible ? undefined : "none",
              }}
              onFocusCapture={() => {
                if (group && layout.focusedGroupId !== group.id) activate(group, tabId);
              }}
              onPointerDownCapture={() => {
                if (group && layout.focusedGroupId !== group.id) activate(group, tabId);
              }}
            >
              {tabId === CONVERSATION_TAB_ID
                ? props.conversation
                : surface
                  ? props.renderSurface(
                      surface,
                      contentVisible,
                      layoutVersion,
                      layout.focusedGroupId === group?.id,
                    )
                  : null}
            </div>
          );
        })}
        {!maximized &&
          geometry.splits.map((line) => (
            <div
              key={line.id}
              role="separator"
              tabIndex={0}
              aria-label={`Resize ${line.axis === "horizontal" ? "columns" : "rows"}`}
              aria-orientation={line.axis === "horizontal" ? "vertical" : "horizontal"}
              aria-valuenow={Math.round(line.ratio * 100)}
              className={cn(
                "absolute z-40 touch-none bg-transparent hover:bg-ring/40 focus-visible:bg-ring/40",
                line.axis === "horizontal"
                  ? "w-1 -translate-x-1/2 cursor-col-resize"
                  : "h-1 -translate-y-1/2 cursor-row-resize",
              )}
              style={
                line.axis === "horizontal"
                  ? {
                      left: `${(line.rect.x + line.rect.width * line.ratio) * 100}%`,
                      top: `${line.rect.y * 100}%`,
                      height: `${line.rect.height * 100}%`,
                    }
                  : {
                      top: `${(line.rect.y + line.rect.height * line.ratio) * 100}%`,
                      left: `${line.rect.x * 100}%`,
                      width: `${line.rect.width * 100}%`,
                    }
              }
              onPointerDown={(event) => resize(event, line)}
              onKeyDown={(event) => {
                const offset =
                  event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -0.05
                    : event.key === "ArrowRight" || event.key === "ArrowDown"
                      ? 0.05
                      : 0;
                if (offset) {
                  event.preventDefault();
                  apply({
                    type: "resize",
                    splitId: line.id,
                    ratio: Math.max(0.12, Math.min(0.88, line.ratio + offset)),
                  });
                }
              }}
            />
          ))}
        {dragging && dropTarget && dropStyle && (
          <div
            className="pointer-events-none absolute z-30 rounded-sm border-2 border-ring bg-ring/15"
            style={dropStyle}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="pointer-events-none absolute right-1 bottom-1 z-20">
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="pointer-events-auto rounded bg-background p-1 text-muted-foreground"
                tabIndex={0}
                aria-label="Tiling shortcuts"
              />
            }
          >
            <CircleHelp className="size-3" />
          </TooltipTrigger>
          <TooltipPopup>
            Ctrl+Alt+arrows: focus tile. Add Shift: split tab. Ctrl+Alt+Enter: maximize. Ctrl+Alt+[
            or ]: switch tab. Drag a tab to group it or split at an edge. Drag the title bar to move
            the whole tile.
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

function TileControl(props: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}
