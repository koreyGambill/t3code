import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { useWorkspaceNavigation } from "./workspaceNavigation";
it("keeps unique recents while preserving a browser cursor and truncating the forward branch", () => {
  useWorkspaceNavigation.setState({ recent: [], stack: [], cursor: -1, pendingKey: null });
  const visit = (id: string) => ({
    ref: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make(id) },
    title: id,
  });
  const store = useWorkspaceNavigation.getState();
  store.visit(visit("one"));
  store.visit(visit("two"));
  store.visit(visit("three"));
  expect(store.move(-1)?.title).toBe("two");
  store.visit(visit("two"));
  expect(useWorkspaceNavigation.getState().stack.map((entry) => entry.title)).toEqual([
    "one",
    "two",
    "three",
  ]);
  store.visit(visit("four"));
  expect(useWorkspaceNavigation.getState().stack.map((entry) => entry.title)).toEqual([
    "one",
    "two",
    "four",
  ]);
  expect(store.move(1)).toBeNull();
  expect(useWorkspaceNavigation.getState().recent.map((entry) => entry.title)).toEqual([
    "four",
    "two",
    "three",
    "one",
  ]);
});
