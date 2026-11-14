import type { ScopedThreadRef, StatusState, ThreadWorkspace } from "@t3tools/contracts";
import type { RightPanelSurface } from "./rightPanelStore";
import type { SidebarView, ThreadContextSection } from "./threadContextSidebarStore";
import type { ThreadTileLayout } from "./threadTileLayout";
import { visibleTileGroups } from "./threadTileGeometry";

export function selectContextThread(
  owner: ScopedThreadRef | null,
  layout: ThreadTileLayout | null,
  surfaces: ReadonlyArray<RightPanelSurface>,
  pinned: ScopedThreadRef | null,
): ScopedThreadRef | null {
  if (pinned) return pinned;
  if (!owner || !layout) return owner;
  const groups = visibleTileGroups(layout);
  const group =
    groups.find((entry) => entry.id === layout.focusedGroupId) ??
    groups.find((entry) => entry.id === layout.maximizedGroupId);
  const surface = surfaces.find((entry) => entry.id === group?.activeTabId);
  return surface?.kind === "side-chat"
    ? { environmentId: owner.environmentId, threadId: surface.threadId }
    : owner;
}

interface SidebarViewState {
  readonly view: SidebarView;
  readonly lastTool: ThreadContextSection;
}

interface ToggleState extends SidebarViewState {
  readonly hidden: ReadonlyArray<string>;
}

/** Selecting the active tool view returns to the thread list. */
export function nextSidebarView(state: SidebarViewState, view: SidebarView): SidebarViewState {
  if (view === "threads") return { view, lastTool: state.lastTool };
  return state.view === view ? { view: "threads", lastTool: view } : { view, lastTool: view };
}

/**
 * A hidden sidebar opens on a tool view; a visible one flips between the threads and the last
 * tool. With every tool hidden there is nothing to flip to, so the thread list shows.
 */
export function toggleThreadToolsView(
  state: ToggleState,
  sidebarVisible: boolean,
): SidebarViewState & { revealPending: boolean } {
  const tool = state.hidden.includes(state.lastTool) ? null : state.lastTool;
  if (!sidebarVisible) {
    return {
      view: state.view === "threads" ? (tool ?? "threads") : state.view,
      lastTool: state.lastTool,
      revealPending: true,
    };
  }
  return {
    view: state.view === "threads" ? (tool ?? "threads") : "threads",
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

export const THREAD_TOOL_ORDER: ReadonlyArray<ThreadContextSection> = [
  "todos",
  "artifacts",
  "links",
  "related",
  "details",
  "environments",
  "inspect",
];

export function firstVisibleThreadTool(hidden: ReadonlyArray<string>): ThreadContextSection | null {
  return THREAD_TOOL_ORDER.find((tool) => !hidden.includes(tool)) ?? null;
}

/** Maps a view saved by the retired right panel to the view that replaced it. */
export function migrateThreadToolsView(view: string | undefined): ThreadContextSection {
  switch (view) {
    case "marks":
    case "ticket":
      return "links";
    case "context":
      return "inspect";
    case "artifacts":
    case "related":
    case "details":
    case "environments":
      return view;
    default:
      return "todos";
  }
}

interface RelatedShell {
  readonly id: string;
  readonly forkedFrom?: { readonly type: string; readonly threadId?: string } | null;
  readonly lineage: { readonly parentThreadId?: string | null };
}

export type TalkedWithRelation =
  | "Delegated this thread"
  | "Delegated to"
  | "Forked from"
  | "Fork"
  | "Messaged this thread"
  | "Shared context";

/** Threads this one delegated to, forked, messaged or heard from; siblings are not included. */
export function talkedWithThreads<Shell extends RelatedShell>(input: {
  readonly threadId: string;
  /** This thread's own shell, which names its parent and fork source. */
  readonly self: RelatedShell | null;
  readonly shells: ReadonlyArray<Shell>;
  /** Threads whose messages or replies arrived in this thread. */
  readonly messagedBy: ReadonlySet<string>;
  readonly transfers: ReadonlyArray<{
    readonly sourceThreadId: string;
    readonly targetThreadId: string;
  }>;
}): Array<{ readonly entry: Shell; readonly relation: TalkedWithRelation }> {
  const { self } = input;
  const forkSource = (entry: RelatedShell) =>
    entry.forkedFrom?.type === "run" ? entry.forkedFrom.threadId : undefined;
  return input.shells.flatMap((entry) => {
    if (entry.id === input.threadId) return [];
    const relation: TalkedWithRelation | null =
      entry.id === self?.lineage.parentThreadId
        ? "Delegated this thread"
        : entry.lineage.parentThreadId === input.threadId
          ? "Delegated to"
          : self && entry.id === forkSource(self)
            ? "Forked from"
            : forkSource(entry) === input.threadId
              ? "Fork"
              : input.messagedBy.has(entry.id)
                ? "Messaged this thread"
                : input.transfers.some(
                      (transfer) =>
                        transfer.sourceThreadId === entry.id ||
                        transfer.targetThreadId === entry.id,
                    )
                  ? "Shared context"
                  : null;
    return relation ? [{ entry, relation }] : [];
  });
}

export type ThreadToolsAttentionTone = "alert" | "question" | "warn" | "review" | "todo";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What needs the user while the sidebar is hidden, most urgent first; null when nothing does. */
export function threadToolsAttention(
  signals: ThreadToolSignals,
  monitoring: { readonly state: StatusState | null; readonly unread: number },
): { readonly tone: ThreadToolsAttentionTone; readonly summary: string } | null {
  const items: Array<readonly [ThreadToolsAttentionTone, string]> = [
    ...(monitoring.state === "fail" ? [["alert", "Status alert"] as const] : []),
    ...(signals.questionCount
      ? [
          [
            "question",
            plural(signals.questionCount, "unanswered question", "unanswered questions"),
          ] as const,
        ]
      : []),
    ...(monitoring.state === "warn" ? [["warn", "Status warning"] as const] : []),
    ...(monitoring.unread
      ? [
          [
            "warn",
            plural(monitoring.unread, "unread watcher alert", "unread watcher alerts"),
          ] as const,
        ]
      : []),
    ...(signals.ticketState === "needs_review" ? [["review", "Ticket needs review"] as const] : []),
    ...(signals.listCount
      ? [["todo", plural(signals.listCount, "open todo", "open todos")] as const]
      : []),
  ];
  const first = items[0];
  return first ? { tone: first[0], summary: items.map(([, text]) => text).join(" · ") } : null;
}
