import { LIST_MAX_DEPTH, type ListItem } from "@t3tools/contracts";

export type TodoFilter = "all" | "mine" | "agents";

export interface TodoNode {
  readonly item: ListItem;
  readonly children: ReadonlyArray<TodoNode>;
  /** Shown only so a matching descendant keeps its place under it. */
  readonly context: boolean;
  /** Done items under this one, out of all of them, whatever the filter hides. */
  readonly progress: { readonly done: number; readonly total: number } | null;
}

const closed = (item: ListItem) => item.state === "done" || item.state === "dropped";

function descendants(items: ReadonlyArray<ListItem>, id: string): ListItem[] {
  return items.flatMap((item) =>
    item.parentId === id ? [item, ...descendants(items, item.id)] : [],
  );
}

/** Items as a tree in list order; filtered-out parents stay as context for matching children. */
export function todoTree(
  items: ReadonlyArray<ListItem>,
  options: { readonly filter: TodoFilter; readonly showClosed: boolean },
): TodoNode[] {
  const ids = new Set(items.map((item) => item.id));
  const matches = (item: ListItem) =>
    (options.showClosed || !closed(item)) &&
    (options.filter === "all" || (options.filter === "mine") === (item.owner === "you"));
  const build = (parentId: string | null, depth: number): TodoNode[] =>
    items
      .filter((item) =>
        parentId === null ? !item.parentId || !ids.has(item.parentId) : item.parentId === parentId,
      )
      .flatMap((item) => {
        const children = depth < LIST_MAX_DEPTH - 1 ? build(item.id, depth + 1) : [];
        if (!matches(item) && children.length === 0) return [];
        const all = descendants(items, item.id);
        return [
          {
            item,
            children,
            context: !matches(item),
            progress: all.length
              ? { done: all.filter((child) => child.state === "done").length, total: all.length }
              : null,
          },
        ];
      });
  return build(null, 0);
}

function depthOf(items: ReadonlyArray<ListItem>, item: ListItem): number {
  let depth = 0;
  let parentId = item.parentId;
  while (parentId) {
    depth += 1;
    parentId = items.find((entry) => entry.id === parentId)?.parentId ?? null;
  }
  return depth;
}

function subtreeHeight(items: ReadonlyArray<ListItem>, id: string): number {
  const children = items.filter((item) => item.parentId === id);
  return children.length
    ? 1 + Math.max(...children.map((child) => subtreeHeight(items, child.id)))
    : 0;
}

export function visibleTodoIds(nodes: ReadonlyArray<TodoNode>): Set<string> {
  const ids = new Set<string>();
  const walk = (list: ReadonlyArray<TodoNode>) => {
    for (const node of list) {
      ids.add(node.item.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

export interface TodoIndentMove {
  readonly parentId: string | null;
  /** The whole list's order, with the item last among its new siblings. */
  readonly order: ReadonlyArray<string>;
}

/**
 * Indents under the previous visible sibling or outdents to the grandparent; undefined when there
 * is no such parent or the subtree would nest deeper than the list allows.
 */
export function todoIndentMove(
  items: ReadonlyArray<ListItem>,
  id: string,
  direction: "in" | "out",
  visible: ReadonlySet<string>,
): TodoIndentMove | undefined {
  const item = items.find((entry) => entry.id === id);
  if (!item) return undefined;
  const rest = items.filter((entry) => entry.id !== id).map((entry) => entry.id);
  const insertAfter = (anchor: string) => {
    const order = [...rest];
    order.splice(order.indexOf(anchor) + 1, 0, id);
    return order;
  };
  if (direction === "out") {
    if (!item.parentId) return undefined;
    const parentId = items.find((entry) => entry.id === item.parentId)?.parentId ?? null;
    return { parentId, order: insertAfter(item.parentId) };
  }
  const siblings = items.filter(
    (entry) =>
      (entry.parentId ?? null) === (item.parentId ?? null) &&
      (entry.id === id || visible.has(entry.id)),
  );
  const previous = siblings[siblings.indexOf(item) - 1];
  if (!previous || depthOf(items, previous) + 1 + subtreeHeight(items, id) >= LIST_MAX_DEPTH)
    return undefined;
  const lastChild = items.findLast((entry) => entry.parentId === previous.id && entry.id !== id);
  return { parentId: previous.id, order: insertAfter(lastChild?.id ?? previous.id) };
}

/** Tab while editing saves the text and moves the item in one write, so neither is lost. */
export function todoTabUpdate(
  items: ReadonlyArray<ListItem>,
  id: string,
  draftText: string | null,
  direction: "in" | "out",
  visible: ReadonlySet<string>,
) {
  const move = todoIndentMove(items, id, direction, visible);
  if (!move) return undefined;
  const text = draftText?.trim();
  const current = items.find((entry) => entry.id === id)?.text;
  return {
    changes: [{ id, parentId: move.parentId, ...(text && text !== current ? { text } : {}) }],
    order: move.order,
  };
}
