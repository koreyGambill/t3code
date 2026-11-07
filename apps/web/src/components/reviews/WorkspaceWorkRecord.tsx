import type {
  ScopedThreadRef,
  ThreadActionItem,
  ThreadWorkspace,
  WorkspaceMutation,
  WorkspaceQuestion,
} from "@t3tools/contracts";
import type { ReactNode } from "react";
import ChatMarkdown from "../ChatMarkdown";
import { AgentWorkList, WorkspaceRecordList } from "./WorkspaceRecordViews";

export function WorkspaceWorkRecord({
  threadRef,
  workspace,
  disabled,
  apply,
  renderQuestion,
  renderAction,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly workspace: ThreadWorkspace;
  readonly disabled: boolean;
  readonly apply: (changes: WorkspaceMutation[]) => void;
  readonly renderQuestion: (question: WorkspaceQuestion) => ReactNode;
  readonly renderAction: (action: ThreadActionItem) => ReactNode;
}) {
  const groupIds = new Set([
    ...workspace.questions.map((item) => item.groupId),
    ...workspace.actionItems.map((item) => item.groupId ?? "ungrouped"),
  ]);
  const groups = [
    ...workspace.groups.filter((group) => groupIds.has(group.id)),
    ...[...groupIds]
      .filter((id) => !workspace.groups.some((group) => group.id === id))
      .map((id) => ({ id, title: "Ungrouped", parentId: null })),
  ];
  const groupTitle = (id: string): string => {
    const group = workspace.groups.find((entry) => entry.id === id);
    const parent = workspace.groups.find((entry) => entry.id === group?.parentId);
    return parent ? `${parent.title} / ${group?.title}` : (group?.title ?? "Ungrouped");
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section aria-label="Agent commitments">
        <h3 className="px-2 pt-2 text-xs font-semibold">Agent commitments</h3>
        <AgentWorkList workspace={workspace} disabled={disabled} apply={apply} embedded />
      </section>
      {groups.length ? (
        <section aria-label="Your questions and actions" className="border-t border-border">
          <h3 className="px-2 py-2 text-xs font-semibold">Needs you · questions & actions</h3>
          {groups.map((group) => {
            const questions = workspace.questions.filter((item) => item.groupId === group.id);
            const actions = workspace.actionItems.filter(
              (item) => (item.groupId ?? "ungrouped") === group.id,
            );
            return (
              <section key={group.id} className="space-y-2 border-t border-border/50 p-2">
                <h4 className="text-2xs font-medium text-muted-foreground">
                  {groupTitle(group.id)}
                </h4>
                {questions.length ? (
                  <div className="space-y-2">
                    <p className="text-3xs text-muted-foreground">You · answers</p>
                    {questions.map(renderQuestion)}
                  </div>
                ) : null}
                {actions.length ? (
                  <div className="space-y-2">
                    <p className="text-3xs text-muted-foreground">You · actions</p>
                    {actions.map(renderAction)}
                  </div>
                ) : null}
              </section>
            );
          })}
        </section>
      ) : null}
      <details className="border-t border-border">
        <summary className="cursor-pointer px-2 py-2 text-xs font-medium">
          Decisions & context · {workspace.decisions.length + workspace.contextItems.length}
        </summary>
        <WorkspaceRecordList workspace={workspace} disabled={disabled} apply={apply} />
      </details>
      <details className="border-t border-border">
        <summary className="cursor-pointer px-2 py-2 text-xs font-medium">Catch-up summary</summary>
        <div className="px-2 pb-3 text-xs">
          {workspace.summaryNotes ? (
            <ChatMarkdown text={workspace.summaryNotes} cwd={undefined} threadRef={threadRef} />
          ) : (
            <p className="text-muted-foreground">No summary recorded.</p>
          )}
        </div>
      </details>
    </div>
  );
}
