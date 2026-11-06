import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
const fixture = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../state/threadMarks", () => ({ threadMarksGet: fixture.query }));
import { Atom, AsyncResult } from "effect/reactivity";
import { RegistryContext } from "@effect/atom-react";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { WorkspaceMarksPanel } from "./WorkspaceMarksPanel";
it("keeps column controls open, searches hidden descriptions, and copies only the visible filtered rows", async () => {
  fixture.query.mockReset().mockReturnValue(
    Atom.make(
      AsyncResult.success([
        {
          url: "https://notion.so/spec",
          service: "Notion",
          timestamp: "2026-11-06T16:25:00Z",
          description: "",
        },
        {
          url: "https://team.slack.com/archives/one",
          service: "Slack",
          timestamp: "2026-11-06T16:25:00Z",
          description: "",
        },
      ]),
    ).pipe(Atom.keepAlive),
  );
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <div className="h-[600px] w-[900px]">
        <WorkspaceMarksPanel
          threadRef={{
            environmentId: EnvironmentId.make("marks-env"),
            threadId: ThreadId.make("marks-thread"),
          }}
          annotations={[{ url: "https://notion.so/spec", description: "Launch requirements" }]}
        />
      </div>
    </RegistryContext.Provider>,
  );
  using clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await page.getByRole("button", { name: "Marks columns and filters" }).click();
  await page.getByRole("checkbox", { name: "UTC", exact: true }).click();
  await expect
    .element(page.getByRole("checkbox", { name: "Description", exact: true }))
    .toBeVisible();
  await page.getByRole("checkbox", { name: "Local time", exact: true }).click();
  await expect
    .element(page.getByRole("checkbox", { name: "Description", exact: true }))
    .toBeVisible();
  await page.getByRole("textbox", { name: "Search all Marks columns" }).click();
  await expect
    .element(page.getByRole("checkbox", { name: "Description", exact: true }))
    .not.toBeInTheDocument();
  await page.getByRole("textbox", { name: "Search all Marks columns" }).fill("launch");
  await expect
    .element(page.getByRole("link", { name: "https://team.slack.com/archives/one" }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Copy all", exact: true }).click();
  await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith("Notion https://notion.so/spec"));
});
