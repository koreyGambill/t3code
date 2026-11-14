import type { ScopedThreadRef, ThreadWorkspace } from "@t3tools/contracts";
import type { RightPanelSurface } from "./rightPanelStore";
import type { SidebarView, ThreadContextSection } from "./threadContextSidebarStore";
import { getTileGroups, type ThreadTileLayout } from "./threadTileLayout";
import { displayTileRoot } from "./threadTileGeometry";

export function selectContextThread(
  owner: ScopedThreadRef | null,
  layout: ThreadTileLayout | null,
  surfaces: ReadonlyArray<RightPanelSurface>,
  pinned: ScopedThreadRef | null,
): ScopedThreadRef | null {
  if (pinned) return pinned;
  if (!owner || !layout) return owner;
  const groups = getTileGroups(displayTileRoot(layout));
  const group = groups.find(
    (entry) => entry.id === (layout.maximizedGroupId ?? layout.focusedGroupId),
  );
  const surface = surfaces.find((entry) => entry.id === group?.activeTabId);
  return surface?.kind === "side-chat"
    ? { environmentId: owner.environmentId, threadId: surface.threadId }
    : owner;
}

interface SidebarViewState {
  readonly view: SidebarView;
  readonly lastTool: ThreadContextSection;
}

/** Selecting the active tool view returns to the thread list. */
export function nextSidebarView(state: SidebarViewState, view: SidebarView): SidebarViewState {
  if (view === "threads") return { view, lastTool: state.lastTool };
  return state.view === view ? { view: "threads", lastTool: view } : { view, lastTool: view };
}

/** A hidden sidebar opens on a tool view; a visible one flips between the threads and the last tool. */
export function toggleThreadToolsView(
  state: SidebarViewState,
  sidebarVisible: boolean,
): SidebarViewState & { revealPending: boolean } {
  if (!sidebarVisible) {
    return {
      view: state.view === "threads" ? state.lastTool : state.view,
      lastTool: state.lastTool,
      revealPending: true,
    };
  }
  return {
    view: state.view === "threads" ? state.lastTool : "threads",
    lastTool: state.lastTool,
    revealPending: false,
  };
}

export interface ThreadToolSignals {
  /** Open list items. */
  readonly listCount: number;
  /** Artifact questions without a submitted answer on each artifact's latest version. */
  readonly questionCount: number;
  readonly ticketState: "open" | "closed" | "needs_review" | "unknown" | null;
}

export function summarizeThreadTools(workspace: ThreadWorkspace | null): ThreadToolSignals {
  if (!workspace) return { listCount: 0, questionCount: 0, ticketState: null };
  const listCount = workspace.items.filter((item) => item.state === "open").length;
  const questionCount = workspace.artifacts.reduce((total, artifact) => {
    const version = artifact.versions.at(-1);
    return (
      total +
      (version?.questions.filter((question) => !version.answers[question.id]?.submittedAt).length ??
        0)
    );
  }, 0);
  const ticketState =
    workspace.items.flatMap((item) => item.linkStates ?? []).find((link) => link.type === "ticket")
      ?.state ?? null;
  return { listCount, questionCount, ticketState };
}
