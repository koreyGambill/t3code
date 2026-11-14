import type { ListItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { todoIndentTarget, todoTree, type TodoNode } from "./todoList.logic";

const item = (
  id: string,
  options: Partial<Pick<ListItem, "owner" | "state" | "parentId">> = {},
): ListItem => ({
  id,
  text: id,
  state: options.state ?? "open",
  owner: options.owner ?? "agent",
  createdAt: "2026-11-13T00:00:00.000Z",
  doneAt: null,
  details: "",
  parentId: options.parentId ?? null,
  links: [],
  needsQa: false,
});

const shape = (nodes: ReadonlyArray<TodoNode>): unknown[] =>
  nodes.map((node) => [
    node.item.id,
    ...(node.context ? ["context"] : []),
    ...(node.children.length ? [shape(node.children)] : []),
  ]);

describe("todoTree", () => {
  const items = [
    item("plan", { owner: "you" }),
    item("build", { parentId: "plan" }),
    item("review", { owner: "you", parentId: "build" }),
    item("ship", { state: "done", owner: "you" }),
    item("orphan", { parentId: "missing" }),
  ];

  it("nests children in list order and hides closed items until asked", () => {
    expect(shape(todoTree(items, { filter: "all", showClosed: false }))).toEqual([
      ["plan", [["build", [["review"]]]]],
      ["orphan"],
    ]);
    expect(
      todoTree(items, { filter: "all", showClosed: true }).map((node) => node.item.id),
    ).toEqual(["plan", "ship", "orphan"]);
  });

  it("keeps a filtered-out parent as context for a matching child", () => {
    expect(shape(todoTree(items, { filter: "mine", showClosed: false }))).toEqual([
      ["plan", [["build", "context", [["review"]]]]],
    ]);
    expect(shape(todoTree(items, { filter: "agents", showClosed: false }))).toEqual([
      ["plan", "context", [["build"]]],
      ["orphan"],
    ]);
  });

  it("counts progress over every descendant", () => {
    const done = [
      item("a"),
      item("b", { parentId: "a", state: "done" }),
      item("c", { parentId: "a" }),
    ];
    expect(todoTree(done, { filter: "all", showClosed: false })[0]?.progress).toEqual({
      done: 1,
      total: 2,
    });
  });
});

describe("todoIndentTarget", () => {
  const items = [
    item("a"),
    item("b"),
    item("b1", { parentId: "b" }),
    item("b2", { parentId: "b" }),
    item("b2x", { parentId: "b2" }),
    item("c"),
  ];

  it("indents under the previous sibling and outdents to the grandparent", () => {
    expect(todoIndentTarget(items, "c", "in")).toBe("b");
    expect(todoIndentTarget(items, "b2", "out")).toBeNull();
    expect(todoIndentTarget(items, "b2x", "out")).toBe("b");
  });

  it("refuses moves without a target or past the nesting limit", () => {
    expect(todoIndentTarget(items, "a", "in")).toBeUndefined();
    expect(todoIndentTarget(items, "a", "out")).toBeUndefined();
    expect(todoIndentTarget(items, "b1", "in")).toBeUndefined();
    // Either move would put b2x on a fourth level.
    expect(todoIndentTarget(items, "b2", "in")).toBeUndefined();
    expect(todoIndentTarget(items, "b", "in")).toBeUndefined();
  });
});
