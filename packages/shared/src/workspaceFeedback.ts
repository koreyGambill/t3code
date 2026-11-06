import type {
  ScopedThreadRef,
  ThreadContextRecord,
  ThreadWorkspace,
  WorkspaceUserDraft,
} from "@t3tools/contracts";
import {
  formatComposerContextHref,
  sanitizeComposerContextLabel,
  toComposerContextId,
} from "./composerContextReferences.ts";

export function readyWorkspaceFeedbackIds(workspace: ThreadWorkspace): string[] {
  return [
    ...workspace.questions.filter((question) => {
      const answer = workspace.userDraft.questionAnswers[question.id];
      return answer && (answer.selectedOptionIds.length > 0 || answer.notes.trim());
    }),
    ...workspace.actionItems.filter(
      (action) => action.status === "done" || workspace.userDraft.actionNotes[action.id]?.trim(),
    ),
  ].map((item) => item.id);
}

export function formatWorkspaceFeedback(
  threadRef: ScopedThreadRef,
  workspace: ThreadWorkspace,
  itemIds: ReadonlyArray<string>,
) {
  const wanted = new Set(itemIds);
  const items = [...workspace.questions, ...workspace.actionItems].filter((item) =>
    wanted.has(item.id),
  );
  const records = items.map((item): ThreadContextRecord => ({
    version: 1,
    kind: "thread",
    contextId: toComposerContextId(`workspace-${item.id}`),
    label: sanitizeComposerContextLabel(`${item.ref ?? item.id} ${item.title}`, "thread"),
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    title: item.title.slice(0, 200),
    workspaceItemId: item.id,
    workspaceSection: workspace.questions.some((question) => question.id === item.id)
      ? "questions"
      : "actions",
  }));
  const markdown = items
    .map((item, index) => {
      const record = records[index]!;
      const heading = `[${record.label}](${formatComposerContextHref("thread", record.contextId)})`;
      const question = workspace.questions.find((question) => question.id === item.id);
      const answer = workspace.userDraft.questionAnswers[item.id];
      if (question && answer)
        return [
          heading,
          `Question: ${question.title}`,
          ...(answer.selectedOptionIds.length
            ? [
                `Answer: ${answer.selectedOptionIds.map((id) => question.options.find((option) => option.id === id)?.label ?? id).join("; ")}`,
              ]
            : []),
          ...(answer.notes.trim() ? [`Notes: ${answer.notes.trim()}`] : []),
        ].join("\n");
      const action = workspace.actionItems.find((action) => action.id === item.id)!;
      const note = workspace.userDraft.actionNotes[item.id];
      return [
        heading,
        `Action: ${action.title}`,
        `Status: ${action.status}`,
        ...(note?.trim() ? [`Notes: ${note.trim()}`] : []),
      ].join("\n");
    })
    .join("\n\n");
  return { records, markdown };
}

export function workspaceDraftError(
  workspace: ThreadWorkspace,
  draft: WorkspaceUserDraft,
): string | null {
  for (const [id, answer] of Object.entries(draft.questionAnswers)) {
    const question = workspace.questions.find((question) => question.id === id);
    if (!question) continue;
    if (
      new Set(answer.selectedOptionIds).size !== answer.selectedOptionIds.length ||
      answer.selectedOptionIds.some(
        (optionId) => !question.options.some((option) => option.id === optionId),
      ) ||
      (!question.multiSelect && answer.selectedOptionIds.length > 1)
    )
      return "Answer selections must match the question's options and selection mode.";
  }
  return null;
}
