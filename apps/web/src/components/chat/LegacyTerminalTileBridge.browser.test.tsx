import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../../terminalUiStateStore";
import { LegacyTerminalTileBridge } from "./LegacyTerminalTileBridge";

it("moves drawer groups into areas, preserving existing owners and later legacy opens", async () => {
  const threadRef = {
    environmentId: EnvironmentId.make("terminal-tile-migration"),
    threadId: ThreadId.make("thread"),
  };
  useRightPanelStore.setState({ byThreadKey: {} });
  useTerminalUiStateStore.setState({
    terminalUiStateByThreadKey: {},
    suppressedTerminalIdsByThreadKey: {},
  });
  const drawer = useTerminalUiStateStore.getState();
  drawer.newTerminal(threadRef, "shell-1");
  drawer.splitTerminalVertical(threadRef, "shell-2");
  drawer.newTerminal(threadRef, "shell-3");
  useRightPanelStore.getState().openTerminal(threadRef, "shell-1");
  const panelState = () =>
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
  const drawerState = () =>
    selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      threadRef,
    );

  // The bridge only migrates store placements and has no navigation.
  await using _screen = await render(<LegacyTerminalTileBridge threadRef={threadRef} />, {
    router: false,
  });
  await vi.waitFor(() => {
    expect(drawerState().terminalOpen).toBe(false);
    expect(panelState().surfaces).toEqual([
      {
        id: "terminal:shell-1",
        kind: "terminal",
        resourceId: "shell-1",
        terminalIds: ["shell-1", "shell-2"],
        activeTerminalId: "shell-2",
        splitDirection: "vertical",
      },
      {
        id: "terminal:shell-3",
        kind: "terminal",
        resourceId: "shell-3",
        terminalIds: ["shell-3"],
        activeTerminalId: "shell-3",
      },
    ]);
    expect(panelState().activeSurfaceId).toBe("terminal:shell-3");
    expect(drawerState().terminalIds).toEqual(["shell-1", "shell-2", "shell-3"]);
  });

  drawer.newTerminal(threadRef, "shell-4");
  await vi.waitFor(() => {
    expect(drawerState().terminalOpen).toBe(false);
    expect(
      panelState().surfaces.flatMap((surface) =>
        surface.kind === "terminal" ? surface.terminalIds : [],
      ),
    ).toEqual(["shell-1", "shell-2", "shell-3", "shell-4"]);
    expect(panelState().activeSurfaceId).toBe("terminal:shell-4");
  });
});
