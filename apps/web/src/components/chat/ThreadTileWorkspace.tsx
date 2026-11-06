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
  X,
} from "lucide-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
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
  panels: PanelActions;
  renderSurface: (
    surface: RightPanelSurface,
    visible: boolean,
    layoutVersion: string,
    focused: boolean,
  ) => ReactNode;
}) {
  const threadKey = scopedThreadKey(props.threadRef);
  const savedLayout = useRightPanelStore((state) =>
    selectThreadTileLayout(state.byThreadKey, props.threadRef),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
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
      ...visibleTabIds.filter((id) => id !== CONVERSATION_TAB_ID),
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
      : "Area";
  };
  const activate = (group: TileGroup, tabId: string) => {
    apply({ type: "activate", groupId: group.id, tabId });
    const surface = props.panels.surfaces.find((entry) => entry.id === tabId);
    if (surface) props.panels.onActivate(surface);
  };
  const split = (group: TileGroup, axis: "horizontal" | "vertical") => {
    let tabId = group.activeTabId;
    if (group.tabs.length < 2) {
      const before = new Set(props.panels.surfaces.map((surface) => surface.id));
      apply({ type: "focus", groupId: group.id });
      if (props.panels.terminalAvailable) props.panels.onAddTerminal();
      else if (props.panels.filesAvailable) props.panels.onAddFiles();
      else return;
      const current = useRightPanelStore.getState().byThreadKey[threadKey];
      const added = current?.surfaces.find((surface) => !before.has(surface.id));
      if (!added) return;
      tabId = added.id;
    }
    apply({
      type: "split",
      tabId,
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
      if (group)
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
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-thread-tiling>
      {props.header}
      <div ref={rootRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-border/40">
        {visibleGroups.map(({ id, rect }) => {
          const group = groups.find((entry) => entry.id === id)!;
          const canSplit =
            group.tabs.length > 1 || props.panels.terminalAvailable || props.panels.filesAvailable;
          return (
            <section
              key={id}
              style={rectStyle(rect)}
              className={cn(
                "absolute overflow-hidden border bg-background",
                layout.focusedGroupId === id ? "border-ring/60" : "border-border",
              )}
              aria-label={`Tile: ${title(group.activeTabId)}`}
            >
              <div
                className="flex h-8 min-w-0 items-center gap-0.5 border-b border-border bg-muted/30 px-1"
                onPointerDown={() => apply({ type: "focus", groupId: id })}
              >
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
                        className={cn(
                          "flex shrink-0 items-center rounded-sm",
                          group.activeTabId === tabId && "bg-accent text-accent-foreground",
                        )}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={group.activeTabId === tabId}
                          aria-label={title(tabId)}
                          className="flex max-w-44 min-w-0 cursor-pointer items-center gap-1.5 px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(TAB_DRAG_TYPE, tabId);
                            event.dataTransfer.effectAllowed = "move";
                            setDraggingTab(tabId);
                          }}
                          onDragOver={(event) => {
                            if (event.dataTransfer.types.includes(TAB_DRAG_TYPE))
                              event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const movedId = event.dataTransfer.getData(TAB_DRAG_TYPE);
                            if (groups.some((entry) => entry.tabs.includes(movedId)))
                              apply({
                                type: "move",
                                tabId: movedId,
                                targetGroupId: id,
                                index: group.tabs.indexOf(tabId),
                              });
                            setDraggingTab(null);
                          }}
                          onDragEnd={() => setDraggingTab(null)}
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
                <TileControl
                  label={
                    group.tabs.length > 1 ? "Split tab right" : "Split right with a new terminal"
                  }
                  disabled={!canSplit}
                  onClick={() => split(group, "horizontal")}
                >
                  <Columns2 />
                </TileControl>
                <TileControl
                  label={
                    group.tabs.length > 1 ? "Split tab below" : "Split below with a new terminal"
                  }
                  disabled={!canSplit}
                  onClick={() => split(group, "vertical")}
                >
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
            visible && !(surface?.kind === "preview" && (draggingTab !== null || resizing));
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
                top: `calc(${rect.y * 100}% + 32px)`,
                height: `calc(${rect.height * 100}% - 32px)`,
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
        {draggingTab &&
          visibleGroups.map(({ id, rect }) => (
            <div
              key={id}
              className="absolute z-30 grid grid-cols-[24%_1fr_24%] grid-rows-[24%_1fr_24%] gap-1 p-2"
              style={{
                ...rectStyle(rect),
                top: `calc(${rect.y * 100}% + 32px)`,
                height: `calc(${rect.height * 100}% - 32px)`,
              }}
            >
              {(["top", "left", "center", "right", "bottom"] as const).map((zone) => (
                <div
                  key={zone}
                  className="flex items-center justify-center rounded border border-ring/50 bg-accent/80 text-xs text-accent-foreground"
                  style={{
                    gridColumn: zone === "left" ? 1 : zone === "right" ? 3 : 2,
                    gridRow: zone === "top" ? 1 : zone === "bottom" ? 3 : 2,
                  }}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(TAB_DRAG_TYPE)) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const tabId = event.dataTransfer.getData(TAB_DRAG_TYPE);
                    if (!groups.some((group) => group.tabs.includes(tabId))) return;
                    if (zone === "center") apply({ type: "move", tabId, targetGroupId: id });
                    else
                      apply({
                        type: "split",
                        tabId,
                        targetGroupId: id,
                        axis: zone === "left" || zone === "right" ? "horizontal" : "vertical",
                        side: zone === "left" || zone === "top" ? "before" : "after",
                        groupId: randomUUID(),
                        splitId: randomUUID(),
                      });
                    setDraggingTab(null);
                  }}
                >
                  {zone === "center" ? "Group tabs" : "Split"}
                </div>
              ))}
            </div>
          ))}
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
            or ]: switch tab. Drag a tab to group it or split at an edge.
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
