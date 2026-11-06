export const CONVERSATION_TAB_ID = "conversation";

export type TileGroup = {
  kind: "group";
  id: string;
  tabs: string[];
  activeTabId: string;
  colorIndex?: number;
};
export type TileSplit = {
  kind: "split";
  id: string;
  axis: "horizontal" | "vertical";
  ratio: number;
  first: TileNode;
  second: TileNode;
};
export type TileNode = TileGroup | TileSplit;
export type ThreadTileLayout = {
  root: TileNode;
  focusedGroupId: string;
  maximizedGroupId: string | null;
  focusPairGroupId?: string | null;
  focusPairRatio?: number;
};
export type TileAction =
  | { type: "focus-pair"; groupId: string | null }
  | { type: "resize-focus-pair"; ratio: number }
  | { type: "activate"; groupId: string; tabId: string }
  | { type: "focus"; groupId: string }
  | { type: "move"; tabId: string; targetGroupId: string; index?: number }
  | {
      type: "split";
      tabId: string;
      targetGroupId: string;
      axis: "horizontal" | "vertical";
      side: "before" | "after";
      groupId: string;
      splitId: string;
    }
  | {
      type: "new-group";
      targetGroupId: string;
      axis: "horizontal" | "vertical";
      side: "before" | "after";
      groupId: string;
      splitId: string;
    }
  | { type: "close-group"; groupId: string }
  | { type: "merge-groups"; groupId: string; targetGroupId: string }
  | { type: "swap-groups"; firstGroupId: string; secondGroupId: string }
  | {
      type: "dock-group";
      groupId: string;
      targetGroupId: string;
      axis: "horizontal" | "vertical";
      side: "before" | "after";
      splitId: string;
    }
  | { type: "resize"; splitId: string; ratio: number }
  | { type: "maximize"; groupId: string | null };

export function getTileGroups(layout: ThreadTileLayout | TileNode): TileGroup[] {
  const node = "root" in layout ? layout.root : layout;
  return node.kind === "group"
    ? [node]
    : [...getTileGroups(node.first), ...getTileGroups(node.second)];
}

function mapNode(node: TileNode, transform: (node: TileNode) => TileNode): TileNode {
  return transform(
    node.kind === "group"
      ? node
      : { ...node, first: mapNode(node.first, transform), second: mapNode(node.second, transform) },
  );
}

function removeGroup(node: TileNode, groupId: string): TileNode | null {
  if (node.kind === "group") return node.id === groupId ? null : node;
  const first = removeGroup(node.first, groupId);
  const second = removeGroup(node.second, groupId);
  return first && second ? { ...node, first, second } : (first ?? second);
}

function prune(
  node: TileNode,
  valid: Set<string>,
  emptyGroupIds: Set<string>,
  seen = new Set<string>(),
): TileNode | null {
  if (node.kind === "group") {
    const tabs = node.tabs.filter((id) => {
      if (!valid.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return tabs.length || emptyGroupIds.has(node.id)
      ? {
          ...node,
          tabs,
          activeTabId: tabs.includes(node.activeTabId) ? node.activeTabId : (tabs[0] ?? ""),
        }
      : null;
  }
  const first = prune(node.first, valid, emptyGroupIds, seen);
  const second = prune(node.second, valid, emptyGroupIds, seen);
  return first && second ? { ...node, first, second } : (first ?? second);
}

function settle(layout: ThreadTileLayout): ThreadTileLayout {
  const groups = getTileGroups(layout);
  const occupiedColors = new Set(
    groups.flatMap((group) => (group.colorIndex !== undefined ? [group.colorIndex] : [])),
  );
  let recycledColor = 0;
  const root = mapNode(layout.root, (node) => {
    if (node.kind !== "group" || node.colorIndex !== undefined) return node;
    const colorIndex =
      Array.from({ length: 8 }, (_, index) => index).find((index) => !occupiedColors.has(index)) ??
      recycledColor++ % 8;
    occupiedColors.add(colorIndex);
    return { ...node, colorIndex };
  });
  return {
    ...layout,
    root,
    ...(layout.focusPairGroupId &&
    !groups.some(
      (group) => group.id === layout.focusPairGroupId && !group.tabs.includes(CONVERSATION_TAB_ID),
    )
      ? { focusPairGroupId: null }
      : {}),
    focusedGroupId: groups.some((group) => group.id === layout.focusedGroupId)
      ? layout.focusedGroupId
      : groups[0]!.id,
    maximizedGroupId: groups.some((group) => group.id === layout.maximizedGroupId)
      ? layout.maximizedGroupId
      : null,
  };
}

export function syncTileLayout(
  layout: ThreadTileLayout | undefined,
  previousSurfaceIds: string[],
  surfaceIds: string[],
  activeSurfaceId: string | null,
  activate: boolean,
): ThreadTileLayout {
  if (!layout) {
    const conversation: TileGroup = {
      kind: "group",
      id: "conversation-group",
      colorIndex: 0,
      tabs: [CONVERSATION_TAB_ID],
      activeTabId: CONVERSATION_TAB_ID,
    };
    if (!surfaceIds.length)
      return { root: conversation, focusedGroupId: conversation.id, maximizedGroupId: null };
    const panels: TileGroup = {
      kind: "group",
      id: "panels-group",
      colorIndex: 1,
      tabs: [...surfaceIds],
      activeTabId: surfaceIds.includes(activeSurfaceId ?? "") ? activeSurfaceId! : surfaceIds[0]!,
    };
    return {
      root: {
        kind: "split",
        id: "initial-split",
        axis: "horizontal",
        ratio: 0.55,
        first: conversation,
        second: panels,
      },
      focusedGroupId: panels.id,
      maximizedGroupId: null,
    };
  }
  const valid = new Set([CONVERSATION_TAB_ID, ...surfaceIds]);
  const emptyGroupIds = new Set(
    getTileGroups(layout)
      .filter((group) => !group.tabs.length)
      .map((group) => group.id),
  );
  const root = prune(layout.root, valid, emptyGroupIds);
  if (!root) return syncTileLayout(undefined, [], surfaceIds, activeSurfaceId, activate);
  let next = settle({ ...layout, root });
  if (
    activate &&
    activeSurfaceId &&
    surfaceIds.includes(activeSurfaceId) &&
    getTileGroups(next).some((group) => group.id === next.focusedGroupId && !group.tabs.length)
  ) {
    next = applyTileAction(next, {
      type: "move",
      tabId: activeSurfaceId,
      targetGroupId: next.focusedGroupId,
    });
  }
  const present = new Set(getTileGroups(next).flatMap((group) => group.tabs));
  const missing = [...valid].filter((id) => !present.has(id));
  if (missing.length) {
    next = {
      ...next,
      root: mapNode(next.root, (node) =>
        node.kind === "group" && node.id === next.focusedGroupId
          ? { ...node, tabs: [...node.tabs, ...missing] }
          : node,
      ),
    };
  }
  if (
    activate &&
    activeSurfaceId &&
    (surfaceIds.includes(activeSurfaceId) || !previousSurfaceIds.includes(activeSurfaceId))
  ) {
    const owner = getTileGroups(next).find((group) => group.tabs.includes(activeSurfaceId));
    if (owner)
      next = applyTileAction(next, { type: "activate", groupId: owner.id, tabId: activeSurfaceId });
  }
  return next;
}

export function applyTileAction(layout: ThreadTileLayout, action: TileAction): ThreadTileLayout {
  const groups = getTileGroups(layout);
  if (action.type === "focus-pair") {
    if (
      action.groupId !== null &&
      !groups.some(
        (group) => group.id === action.groupId && !group.tabs.includes(CONVERSATION_TAB_ID),
      )
    )
      return layout;
    return {
      ...layout,
      focusPairGroupId: action.groupId,
      focusPairRatio: layout.focusPairRatio ?? 0.55,
      focusedGroupId: action.groupId ?? layout.focusedGroupId,
      maximizedGroupId: null,
    };
  }
  if (action.type === "resize-focus-pair")
    return Number.isFinite(action.ratio)
      ? { ...layout, focusPairRatio: Math.min(0.9, Math.max(0.1, action.ratio)) }
      : layout;
  if (action.type === "maximize") {
    const group = groups.find((entry) => entry.id === action.groupId);
    return {
      ...layout,
      ...(layout.focusPairGroupId && group && !group.tabs.includes(CONVERSATION_TAB_ID)
        ? { focusPairGroupId: group.id }
        : {}),
      maximizedGroupId: group?.id ?? null,
    };
  }
  if (action.type === "resize")
    return Number.isFinite(action.ratio)
      ? {
          ...layout,
          root: mapNode(layout.root, (node) =>
            node.kind === "split" && node.id === action.splitId
              ? { ...node, ratio: Math.min(0.9, Math.max(0.1, action.ratio)) }
              : node,
          ),
        }
      : layout;
  if (action.type === "focus" || action.type === "activate") {
    const group = groups.find((entry) => entry.id === action.groupId);
    if (!group || (action.type === "activate" && !group.tabs.includes(action.tabId))) return layout;
    return {
      ...layout,
      focusedGroupId: group.id,
      ...(layout.focusPairGroupId && !group.tabs.includes(CONVERSATION_TAB_ID)
        ? { focusPairGroupId: group.id }
        : {}),
      maximizedGroupId: layout.maximizedGroupId === group.id ? group.id : null,
      root:
        action.type === "activate"
          ? mapNode(layout.root, (node) =>
              node.id === group.id && node.kind === "group"
                ? { ...node, activeTabId: action.tabId }
                : node,
            )
          : layout.root,
    };
  }
  if (action.type === "close-group") {
    const group = groups.find((entry) => entry.id === action.groupId);
    if (!group || group.tabs.length) return layout;
    const root = removeGroup(layout.root, group.id);
    return root ? settle({ ...layout, root }) : layout;
  }
  if (action.type === "new-group") {
    if (
      !groups.some((group) => group.id === action.targetGroupId) ||
      !action.groupId ||
      !action.splitId ||
      action.groupId === action.splitId
    )
      return layout;
    let conflictingId = false;
    mapNode(layout.root, (node) => {
      if (node.id === action.groupId || node.id === action.splitId) conflictingId = true;
      return node;
    });
    if (conflictingId) return layout;
    const added: TileGroup = { kind: "group", id: action.groupId, tabs: [], activeTabId: "" };
    return settle({
      ...layout,
      ...(layout.focusPairGroupId ? { focusPairGroupId: null } : {}),
      root: mapNode(layout.root, (node) =>
        node.id === action.targetGroupId
          ? {
              kind: "split",
              id: action.splitId,
              axis: action.axis,
              ratio: 0.5,
              first: action.side === "before" ? added : node,
              second: action.side === "before" ? node : added,
            }
          : node,
      ),
      focusedGroupId: added.id,
      maximizedGroupId: null,
    });
  }
  if (action.type === "merge-groups") {
    const source = groups.find((group) => group.id === action.groupId);
    const target = groups.find((group) => group.id === action.targetGroupId);
    if (!source?.tabs.length || !target || source.id === target.id) return layout;
    return settle({
      ...layout,
      root: mapNode(removeGroup(layout.root, source.id)!, (node) =>
        node.kind === "group" && node.id === target.id
          ? { ...node, tabs: [...node.tabs, ...source.tabs], activeTabId: source.activeTabId }
          : node,
      ),
      focusedGroupId: target.id,
      maximizedGroupId: null,
    });
  }
  if (action.type === "swap-groups") {
    const first = groups.find((group) => group.id === action.firstGroupId);
    const second = groups.find((group) => group.id === action.secondGroupId);
    if (!first || !second || first.id === second.id) return layout;
    return settle({
      ...layout,
      root: mapNode(layout.root, (node) =>
        node.id === first.id ? second : node.id === second.id ? first : node,
      ),
      focusedGroupId: first.id,
      maximizedGroupId: null,
    });
  }
  if (action.type === "dock-group") {
    const source = groups.find((group) => group.id === action.groupId);
    const target = groups.find((group) => group.id === action.targetGroupId);
    if (!source || !target || source.id === target.id || !action.splitId) return layout;
    let conflictingId = false;
    mapNode(layout.root, (node) => {
      if (node.id === action.splitId) conflictingId = true;
      return node;
    });
    if (conflictingId) return layout;
    const remaining = removeGroup(layout.root, source.id)!;
    return settle({
      ...layout,
      root: mapNode(remaining, (node) =>
        node.id === target.id
          ? {
              kind: "split",
              id: action.splitId,
              axis: action.axis,
              ratio: 0.5,
              first: action.side === "before" ? source : node,
              second: action.side === "before" ? node : source,
            }
          : node,
      ),
      focusedGroupId: source.id,
      maximizedGroupId: null,
    });
  }
  const source = groups.find((group) => group.tabs.includes(action.tabId));
  const target = groups.find((group) => group.id === action.targetGroupId);
  if (!source || !target) return layout;
  if (action.type === "split" && source.id === target.id && source.tabs.length === 1) return layout;
  if (action.type === "split") {
    const ids = new Set<string>();
    mapNode(layout.root, (node) => {
      ids.add(node.id);
      return node;
    });
    if (ids.has(action.groupId) || ids.has(action.splitId) || action.groupId === action.splitId)
      return layout;
  }
  let root = mapNode(layout.root, (node) => {
    if (node.kind !== "group") return node;
    const tabs = node.tabs.filter((id) => id !== action.tabId);
    if (action.type === "move" && node.id === target.id)
      tabs.splice(Math.min(tabs.length, Math.max(0, action.index ?? tabs.length)), 0, action.tabId);
    const group = {
      ...node,
      tabs,
      activeTabId:
        node.id === target.id && action.type === "move"
          ? action.tabId
          : tabs.includes(node.activeTabId)
            ? node.activeTabId
            : (tabs[0] ?? ""),
    };
    if (action.type !== "split" || node.id !== target.id) return group;
    const added: TileGroup = {
      kind: "group",
      id: action.groupId,
      tabs: [action.tabId],
      activeTabId: action.tabId,
    };
    return {
      kind: "split",
      id: action.splitId,
      axis: action.axis,
      ratio: 0.5,
      first: action.side === "before" ? added : group,
      second: action.side === "before" ? group : added,
    };
  });
  root = prune(
    root,
    new Set(groups.flatMap((group) => group.tabs)),
    new Set(groups.filter((group) => !group.tabs.length).map((group) => group.id)),
  )!;
  return settle({
    ...layout,
    ...(action.type === "split" && layout.focusPairGroupId ? { focusPairGroupId: null } : {}),
    root,
    focusedGroupId: action.type === "split" ? action.groupId : target.id,
    maximizedGroupId: null,
  });
}

export function parseTileLayout(value: unknown): ThreadTileLayout | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("root" in value) ||
    !("focusedGroupId" in value) ||
    typeof value.focusedGroupId !== "string"
  )
    return undefined;
  const ids = new Set<string>();
  let count = 0;
  const parse = (raw: unknown, depth: number): TileNode | null => {
    if (
      !raw ||
      typeof raw !== "object" ||
      depth > 32 ||
      ++count > 255 ||
      !("id" in raw) ||
      typeof raw.id !== "string" ||
      !raw.id ||
      ids.has(raw.id) ||
      !("kind" in raw)
    )
      return null;
    ids.add(raw.id);
    if (raw.kind === "group") {
      if (
        !("tabs" in raw) ||
        !Array.isArray(raw.tabs) ||
        raw.tabs.length > 1024 ||
        !raw.tabs.every((id): id is string => typeof id === "string") ||
        !("activeTabId" in raw) ||
        typeof raw.activeTabId !== "string" ||
        (!raw.tabs.length && raw.activeTabId !== "")
      )
        return null;
      return {
        kind: "group",
        id: raw.id,
        tabs: raw.tabs,
        activeTabId: raw.activeTabId,
        ...("colorIndex" in raw &&
        typeof raw.colorIndex === "number" &&
        Number.isInteger(raw.colorIndex) &&
        raw.colorIndex >= 0 &&
        raw.colorIndex < 8
          ? { colorIndex: raw.colorIndex }
          : {}),
      };
    }
    if (
      raw.kind !== "split" ||
      !("axis" in raw) ||
      (raw.axis !== "horizontal" && raw.axis !== "vertical") ||
      !("ratio" in raw) ||
      typeof raw.ratio !== "number" ||
      !Number.isFinite(raw.ratio) ||
      !("first" in raw) ||
      !("second" in raw)
    )
      return null;
    const first = parse(raw.first, depth + 1);
    const second = parse(raw.second, depth + 1);
    return first && second
      ? {
          kind: "split",
          id: raw.id,
          axis: raw.axis,
          ratio: Math.min(0.9, Math.max(0.1, raw.ratio)),
          first,
          second,
        }
      : null;
  };
  const root = parse(value.root, 0);
  return root
    ? settle({
        root,
        ...("focusPairGroupId" in value &&
        (typeof value.focusPairGroupId === "string" || value.focusPairGroupId === null)
          ? { focusPairGroupId: value.focusPairGroupId }
          : {}),
        ...("focusPairRatio" in value &&
        typeof value.focusPairRatio === "number" &&
        Number.isFinite(value.focusPairRatio)
          ? { focusPairRatio: Math.min(0.9, Math.max(0.1, value.focusPairRatio)) }
          : {}),
        focusedGroupId: value.focusedGroupId,
        maximizedGroupId:
          "maximizedGroupId" in value && typeof value.maximizedGroupId === "string"
            ? value.maximizedGroupId
            : null,
      })
    : undefined;
}
