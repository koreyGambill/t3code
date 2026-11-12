import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { __testing as previewTesting } from "../../previewStateStore";
import { usePreviewMiniPlayerStore } from "../../previewMiniPlayerStore";
import {
  selectThreadRightPanelState,
  selectThreadTileLayout,
  useRightPanelStore,
} from "../../rightPanelStore";
import { getTileGroups } from "../../threadTileLayout";
import { dispatchPreviewAction } from "../preview/previewActionBus";
import { useRightPanelActions } from "./useRightPanelActions";

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("./ChatOverlayHosts", () => ({ openDeviceSetupDialog: vi.fn() }));
vi.mock("../preview/agentOpenedPreviews", () => ({ floatDeviceSurface: vi.fn() }));

it("routes panel commands to tiled owners while retaining the narrow panel close behavior", async () => {
  const threadRef = {
    environmentId: EnvironmentId.make("panel-tile-actions"),
    threadId: ThreadId.make("thread"),
  };
  useRightPanelStore.setState({ byThreadKey: {} });
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  const store = useRightPanelStore.getState();
  store.openBrowser(threadRef, "browser-tab");
  const panelState = () =>
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
  const layout = () => selectThreadTileLayout(useRightPanelStore.getState().byThreadKey, threadRef);
  const browser = panelState().surfaces[0]!;
  const conversation = getTileGroups(layout()).find((group) =>
    group.tabs.includes("conversation"),
  )!;
  store.applyTileAction(threadRef, {
    type: "move",
    tabId: browser.id,
    targetGroupId: conversation.id,
  });
  store.applyTileAction(threadRef, {
    type: "activate",
    groupId: conversation.id,
    tabId: "conversation",
  });
  function Harness({ tiled }: { tiled: boolean }) {
    const panel = useRightPanelStore((state) =>
      selectThreadRightPanelState(state.byThreadKey, threadRef),
    );
    const actions = useRightPanelActions({
      tiled,
      activeThreadRef: threadRef,
      activeProject: null,
      activeRightPanelSurface: browser,
      activePreviewState: {
        ...previewTesting.EMPTY_THREAD_PREVIEW_STATE,
        activeTabId: "browser-tab",
      },
      deviceState: {
        hosts: [],
        hostStatus: "disabled",
        hostStatuses: {},
        devices: [],
        sessions: [],
        onboardingCompleted: false,
        agentAccessEnabled: false,
        hubBasePath: "/api/device-hub",
        revision: 0,
      },
      deviceStateLoaded: false,
      pullRequestPanelTarget: null,
      threadPanelPresentation: "inline",
      isServerThread: true,
      embedded: false,
      isGitRepo: false,
      browserAvailable: true,
      canOperatePreview: true,
      diffOpen: false,
      previewPanelOpen: panel.isOpen,
      rightPanelOpen: panel.isOpen,
      canMaximizeRightPanel: panel.isOpen,
      rightPanelMaximized: panel.maximized === true,
      supportsPullRequests: false,
      pullRequestsSurfaceAvailable: false,
      gitCwd: null,
      activeProjectCwd: null,
      onDiffPanelOpen: undefined,
      closeRightPanelSurface: (surface) => store.closeSurface(threadRef, surface.id),
    });
    return (
      <>
        <button onClick={actions.toggleRightPanelStable}>Panel</button>
        <button onClick={actions.toggleRightPanelMaximizedStable}>Maximize</button>
        <button onClick={() => dispatchPreviewAction("toggle-panel")}>Browser</button>
      </>
    );
  }
  // This hook drives store transitions without navigating.
  await using screen = await render(<Harness tiled />, { router: false });
  await userEvent.click(screen.getByRole("button", { name: "Panel", exact: true }));
  expect(panelState().isOpen).toBe(true);
  expect(getTileGroups(layout())[0]?.activeTabId).toBe(browser.id);
  expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
  await userEvent.click(screen.getByRole("button", { name: "Maximize" }));
  expect(layout().maximizedGroupId).toBe(conversation.id);
  await userEvent.click(screen.getByRole("button", { name: "Maximize" }));
  expect(layout().maximizedGroupId).toBeNull();
  store.applyTileAction(threadRef, {
    type: "activate",
    groupId: conversation.id,
    tabId: "conversation",
  });
  await userEvent.click(screen.getByRole("button", { name: "Browser" }));
  expect(panelState().isOpen).toBe(true);
  expect(getTileGroups(layout())[0]?.activeTabId).toBe(browser.id);
  expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
  await screen.rerender(<Harness tiled={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Panel", exact: true }));
  expect(panelState().isOpen).toBe(false);
  expect(Object.values(usePreviewMiniPlayerStore.getState().byThreadKey)[0]?.source).toEqual({
    kind: "browser",
    tabId: "browser-tab",
  });
});
