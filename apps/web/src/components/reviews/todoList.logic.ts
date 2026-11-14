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
  return items
    .filter((item) => item.parentId === id)
    .flatMap((item) => [item, ...descendants(items, item.id)]);
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

/**
 * The parent an item moves to when indented under its previous sibling or outdented to its
 * grandparent; undefined when the move is impossible or would nest deeper than the list allows.
 */
export function todoIndentTarget(
  items: ReadonlyArray<ListItem>,
  id: string,
  direction: "in" | "out",
): string | null | undefined {
  const item = items.find((entry) => entry.id === id);
  if (!item) return undefined;
  if (direction === "out") {
    if (!item.parentId) return undefined;
    return items.find((entry) => entry.id === item.parentId)?.parentId ?? null;
  }
  const siblings = items.filter((entry) => (entry.parentId ?? null) === (item.parentId ?? null));
  const previous = siblings[siblings.indexOf(item) - 1];
  if (!previous) return undefined;
  return depthOf(items, previous) + 1 + subtreeHeight(items, item.id) < LIST_MAX_DEPTH
    ? previous.id
    : undefined;
}
