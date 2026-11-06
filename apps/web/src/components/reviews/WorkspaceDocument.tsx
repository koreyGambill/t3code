import type {
  ScopedThreadRef,
  ThreadWorkspace,
  WorkspaceGroup,
  WorkspaceQuestion,
  ThreadActionItem,
} from "@t3tools/contracts";
import { PanelLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStableCallback } from "../../hooks/useStableCallback";
import type { ThreadWorkspaceSection } from "../../rightPanelStore";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Popover, PopoverTrigger, PopoverPopup } from "../ui/popover";
import {
  readWorkspaceScroll,
  saveWorkspaceScroll,
  useWorkspaceViewState,
} from "./workspaceViewState";
export function WorkspaceDocument({
  threadRef,
  section,
  workspace,
  renderQuestion,
  renderAction,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly section: ThreadWorkspaceSection;
  readonly workspace: ThreadWorkspace;
  readonly renderQuestion: (question: WorkspaceQuestion) => ReactNode;
  readonly renderAction: (action: ThreadActionItem) => ReactNode;
}) {
  const key = `${threadRef.environmentId}:${threadRef.threadId}`;
  const view = useWorkspaceViewState(
    useShallow(({ closed, outlineHidden, focusedItem, toggle, expand, toggleOutline }) => ({
      closed,
      outlineHidden,
      focusedItem,
      toggle,
      expand,
      toggleOutline,
    })),
  );
  const container = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(workspace.groups[0]?.id ?? "ungrouped");
  const [focusSection, setFocusSection] = useState("design-notes");
  const directGroups = new Set(
    [...workspace.questions, ...workspace.actionItems, ...workspace.designDocuments].map(
      (item) => item.groupId ?? "ungrouped",
    ),
  );
  const virtualGroups = workspace.groups
    .filter(
      (group) =>
        directGroups.has(group.id) && workspace.groups.some((child) => child.parentId === group.id),
    )
    .map((group) => ({ id: `ungrouped:${group.id}`, parentId: group.id, title: "Ungrouped" }));
  const groups = [...workspace.groups, ...virtualGroups];
  const displayGroup = (groupId: string) =>
    virtualGroups.some((group) => group.parentId === groupId) ? `ungrouped:${groupId}` : groupId;
  const scrollKey = `${key}:${section}`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Restores the saved viewport when browser-style thread navigation returns to this panel.
  useEffect(() => {
    if (container.current) container.current.scrollTop = readWorkspaceScroll(scrollKey);
  }, [scrollKey]);
  const jump = (group: WorkspaceGroup, targetSection?: string) => {
    view.expand(key, group.id, groups);
    setFocus(group.id);
    if (targetSection) setFocusSection(targetSection);
    setTimeout(
      () =>
        container.current
          ?.querySelector<HTMLElement>(
            `[data-workspace-anchor="${CSS.escape(`${group.id}:${targetSection ?? "group"}`)}"]`,
          )
          ?.scrollIntoView({ block: "start", behavior: "smooth" }),
      0,
    );
  };
  const outline = (parent: string | null, depth = 0): ReactNode =>
    groups
      .filter((group) => group.parentId === parent && hasContent(group))
      .map((group) => (
        <div key={group.id}>
          <div className="flex items-center">
            <button
              aria-label={`Toggle ${group.title} headings`}
              aria-expanded={!view.closed[`nav:${key}:${group.id}`]}
              className="shrink-0 p-1"
              onClick={() => view.toggle(`nav:${key}:${group.id}`)}
            >
              <ChevronRightIcon
                className={`size-3 ${view.closed[`nav:${key}:${group.id}`] ? "" : "rotate-90"}`}
              />
            </button>
            <button
              aria-current={focus === group.id ? "location" : undefined}
              className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-2xs text-muted-foreground hover:bg-muted aria-[current=location]:bg-muted aria-[current=location]:text-foreground"
              style={{ paddingLeft: depth * 9 + 4 }}
              onClick={() => jump(group)}
            >
              <span className="truncate">{group.title}</span>
            </button>
          </div>
          {!view.closed[`nav:${key}:${group.id}`] ? outline(group.id, depth + 1) : null}
        </div>
      ));
  const docs = (groupId: string) =>
    workspace.designDocuments
      .filter((doc) => displayGroup(doc.groupId) === groupId)
      .map((doc) => (
        <article key={doc.id} id={`workspace-item-${doc.id}`} className="space-y-3">
          <h4 className="text-sm font-medium">
            <span className="mr-2 text-3xs text-muted-foreground">{doc.ref}</span>
            {doc.title}
          </h4>
          {doc.markdown ? (
            <ChatMarkdown text={doc.markdown} cwd={undefined} threadRef={threadRef} />
          ) : null}
          {doc.html ? (
            <iframe
              title={doc.title}
              sandbox=""
              srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:"><style>body{font:14px system-ui;color-scheme:light dark;color:light-dark(#1f2937,#d1d5db);margin:16px}svg{max-width:100%}</style>${doc.html}`}
              className="h-96 w-full rounded border border-border bg-background"
            />
          ) : null}
        </article>
      ));
  const contentSection = (groupId: string, id: string, label: string, children: ReactNode) => (
    <section
      data-workspace-anchor={`${groupId}:${id}`}
      data-workspace-section={id}
      className="scroll-mt-2 space-y-2 py-2"
    >
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      {children}
    </section>
  );
  const groupContent = (group: WorkspaceGroup) => {
    const questions = workspace.questions.filter((item) => displayGroup(item.groupId) === group.id);
    const actions = workspace.actionItems.filter(
      (item) => displayGroup(item.groupId ?? "ungrouped") === group.id,
    );
    return (
      <>
        {(section === "unified" || section === "design-notes") && docs(group.id).length
          ? contentSection(group.id, "design-notes", "Design", docs(group.id))
          : null}
        {(section === "unified" || section === "questions") && questions.length
          ? contentSection(group.id, "questions", "Questions", questions.map(renderQuestion))
          : null}
        {(section === "unified" || section === "action-items") && actions.length
          ? contentSection(group.id, "action-items", "Action items", actions.map(renderAction))
          : null}
      </>
    );
  };
  const hasContent = (group: WorkspaceGroup): boolean =>
    Boolean(
      ((section === "unified" || section === "questions") &&
        workspace.questions.some((item) => displayGroup(item.groupId) === group.id)) ||
      ((section === "unified" || section === "action-items") &&
        workspace.actionItems.some(
          (item) => displayGroup(item.groupId ?? "ungrouped") === group.id,
        )) ||
      ((section === "unified" || section === "design-notes") &&
        workspace.designDocuments.some((item) => displayGroup(item.groupId) === group.id)) ||
      groups.some((child) => child.parentId === group.id && hasContent(child)),
    );
  const renderGroups = (parent: string | null): ReactNode =>
    groups
      .filter((group) => group.parentId === parent && hasContent(group))
      .map((group) => (
        <section
          key={group.id}
          data-workspace-group={group.id}
          data-workspace-anchor={`${group.id}:group`}
          className="scroll-mt-2 border-b border-border/60 py-2"
        >
          <button
            aria-expanded={!view.closed[`${key}:${group.id}`]}
            className="flex w-full items-center gap-2 py-2 text-left text-sm font-semibold"
            onClick={() => view.toggle(`${key}:${group.id}`)}
          >
            <ChevronRightIcon
              className={`size-3.5 ${view.closed[`${key}:${group.id}`] ? "" : "rotate-90"}`}
            />
            {group.title}
          </button>
          {!view.closed[`${key}:${group.id}`] ? (
            <div className="space-y-3 pl-3">
              {groupContent(group)}
              {renderGroups(group.id)}
            </div>
          ) : null}
        </section>
      ));
  const focusRequest = view.focusedItem;
  const revealSource = useStableCallback(
    (focusRequest: typeof view.focusedItem, sourceWorkspace: ThreadWorkspace) => {
      if (focusRequest?.key !== key) return;
      const item = [
        ...sourceWorkspace.questions,
        ...sourceWorkspace.actionItems,
        ...sourceWorkspace.designDocuments,
      ].find((entry) => entry.id === focusRequest.itemId);
      if (!item) return;
      view.expand(key, displayGroup(item.groupId ?? "ungrouped"), groups);
      setTimeout(() => {
        if (useWorkspaceViewState.getState().focusedItem !== focusRequest) return;
        const element = container.current?.querySelector<HTMLElement>(
          `[id="workspace-item-${CSS.escape(item.id)}"]`,
        );
        if (!element) return;
        if (element instanceof HTMLDetailsElement) element.open = true;
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        useWorkspaceViewState.setState((state) =>
          state.focusedItem === focusRequest ? { focusedItem: null } : state,
        );
      }, 0);
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reveals a source requested by a native workspace context chip.
  useEffect(() => {
    revealSource(focusRequest, workspace);
  }, [focusRequest, workspace, revealSource]);
  return (
    <>
      <div className="absolute right-0 top-0 z-10 flex h-7 items-center border-l border-border bg-background px-1">
        <Button
          variant="ghost"
          size="icon-micro"
          aria-label={view.outlineHidden ? "Show headings" : "Hide headings"}
          className="hidden @min-[560px]/workspace:inline-flex"
          onClick={view.toggleOutline}
        >
          <PanelLeftIcon className="size-4" />
        </Button>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-micro"
                aria-label="Browse headings"
                className="@min-[560px]/workspace:hidden"
              >
                <PanelLeftIcon className="size-4" />
              </Button>
            }
          />
          <PopoverPopup side="bottom" align="start" className="w-60">
            <div className="max-h-80 overflow-auto p-2">
              {section === "summary" ? <span className="text-xs">Summary</span> : outline(null)}
            </div>
          </PopoverPopup>
        </Popover>
      </div>
      <div className="flex min-h-0 flex-1">
        {!view.outlineHidden ? (
          <nav
            aria-label="Workspace headings"
            className={`hidden shrink-0 overflow-hidden border-r border-border @min-[560px]/workspace:flex ${section === "unified" ? "w-36 @min-[750px]/workspace:w-44" : "w-24 @min-[750px]/workspace:w-32"}`}
          >
            <div className="min-h-0 min-w-0 flex-1 overflow-auto p-1">
              {section === "summary" ? (
                <button
                  className="p-2 text-xs"
                  onClick={() => container.current?.scrollTo({ top: 0, behavior: "smooth" })}
                >
                  Summary
                </button>
              ) : (
                outline(null)
              )}
            </div>
            {section === "unified" ? (
              <div className="w-20 shrink-0 border-l border-border p-1">
                {[
                  ["design-notes", "Design"],
                  ["questions", "Questions"],
                  ["action-items", "Actions"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={`w-full rounded px-1 py-2 text-left text-3xs ${focusSection === id ? "bg-muted" : "text-muted-foreground"}`}
                    onClick={() => {
                      const group = groups.find((entry) => entry.id === focus);
                      if (group) jump(group, id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </nav>
        ) : null}
        <div
          ref={container}
          data-workspace-scroll
          className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 pb-3"
          onScroll={(event) => {
            const element = event.currentTarget;
            saveWorkspaceScroll(scrollKey, element.scrollTop);
            const top = element.getBoundingClientRect().top;
            const anchors = [...element.querySelectorAll<HTMLElement>("[data-workspace-group]")];
            const current =
              anchors.findLast((anchor) => anchor.getBoundingClientRect().top <= top + 70) ??
              anchors[0];
            if (current?.dataset.workspaceGroup) setFocus(current.dataset.workspaceGroup);
            const currentSection = [
              ...element.querySelectorAll<HTMLElement>("[data-workspace-section]"),
            ].findLast((anchor) => anchor.getBoundingClientRect().top <= top + 90);
            if (currentSection?.dataset.workspaceSection)
              setFocusSection(currentSection.dataset.workspaceSection);
          }}
        >
          {section === "summary" ? (
            <div className="py-2">
              {workspace.summaryNotes ? (
                <ChatMarkdown text={workspace.summaryNotes} cwd={undefined} threadRef={threadRef} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  The agent can keep a catch-up summary here.
                </p>
              )}
            </div>
          ) : (
            <>
              {renderGroups(null)}
              {section === "design-notes" && workspace.designNotes ? (
                <div className="py-4">
                  <ChatMarkdown
                    text={workspace.designNotes}
                    cwd={undefined}
                    threadRef={threadRef}
                  />
                </div>
              ) : null}
              {!groups.some(hasContent) ? (
                <p className="py-5 text-sm text-muted-foreground">
                  Ask the agent to workspace a question, action item, or explanation for later.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
