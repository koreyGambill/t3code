import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type ScopedThreadRef,
  type ThreadWorkspace,
  type WorkspaceQuestionAnswer,
  type WorkspaceUserDraft,
  type ThreadActionItem,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  formatWorkspaceFeedback,
  readyWorkspaceFeedbackIds,
  workspaceDraftError,
} from "@t3tools/shared/workspaceFeedback";
import { useComposerDraftStore } from "../../composerDraftStore";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ChevronRightIcon, CheckIcon, SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useRightPanelStore, type ThreadWorkspaceSection } from "../../rightPanelStore";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import {
  threadWorkspaceCounts,
  threadWorkspaceGet,
  threadWorkspacePatch,
  threadWorkspaceSaveDraft,
} from "../../state/threadWorkspace";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { threadMarksGet } from "../../state/threadMarks";
import { NotesPanel } from "../notes/NotesPanel";
import { useReviewSupport } from "./useReviewSupport";
import { WorkspaceMarksPanel } from "./WorkspaceMarksPanel";
import { WorkspaceThreadsPanel } from "./WorkspaceThreadsPanel";
import { WorkspaceDocument } from "./WorkspaceDocument";
import { WorkspaceQuestionCard } from "./WorkspaceQuestionCard";

const sections = [
  ["unified", "Unified"],
  ["questions", "Questions"],
  ["action-items", "Action items"],
  ["design-notes", "Design"],
  ["summary", "Summary"],
  ["marks", "Marks"],
  ["threads", "Threads"],
  ["notes", "Notes"],
] as const;
const emptyAnswer: WorkspaceQuestionAnswer = { selectedOptionIds: [], notes: "" };
interface LocalDraft {
  readonly draft: WorkspaceUserDraft;
  readonly dirty: boolean;
  readonly generation: number;
  readonly baseRevision: number;
}
const useLocalDrafts = create<{
  entries: Record<string, LocalDraft>;
  edit: (key: string, draft: WorkspaceUserDraft) => void;
  receive: (key: string, draft: WorkspaceUserDraft, revision: number) => void;
  reset: (key: string, draft: WorkspaceUserDraft, revision: number) => void;
  saved: (key: string, generation: number, revision: number) => void;
  rebase: (key: string, revision: number) => void;
}>((set) => ({
  entries: {},
  edit: (key, draft) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [key]: {
          draft,
          dirty: true,
          generation: (state.entries[key]?.generation ?? 0) + 1,
          baseRevision: state.entries[key]?.baseRevision ?? 0,
        },
      },
    })),
  receive: (key, draft, revision) =>
    set((state) =>
      state.entries[key]?.dirty
        ? state
        : {
            entries: {
              ...state.entries,
              [key]: {
                draft,
                dirty: false,
                generation: state.entries[key]?.generation ?? 0,
                baseRevision: revision,
              },
            },
          },
    ),
  reset: (key, draft, revision) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [key]: { draft, dirty: false, generation: 0, baseRevision: revision },
      },
    })),
  rebase: (key, revision) =>
    set((state) => {
      const current = state.entries[key];
      return current
        ? { entries: { ...state.entries, [key]: { ...current, baseRevision: revision } } }
        : state;
    }),
  saved: (key, generation, revision) =>
    set((state) => {
      const current = state.entries[key];
      return current
        ? {
            entries: {
              ...state.entries,
              [key]: {
                ...current,
                dirty: current.generation !== generation,
                baseRevision: revision,
              },
            },
          }
        : state;
    }),
}));

export function ThreadWorkspacePanel({
  threadRef,
  visible,
  startedThread,
  section,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly reviewId: string | null;
  readonly visible: boolean;
  readonly startedThread: boolean;
  readonly section: ThreadWorkspaceSection;
}) {
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const supported = useReviewSupport(threadRef.environmentId);
  const canQuery = visible && startedThread && supported && canRead;
  const counts = useEnvironmentQuery(
    canQuery
      ? threadWorkspaceCounts({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const marks = useEnvironmentQuery(
    canQuery
      ? threadMarksGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const sectionCounts: Partial<Record<ThreadWorkspaceSection, number | undefined>> = {
    questions: counts.data?.questions,
    "action-items": counts.data?.actions,
    "design-notes": counts.data?.designs,
    threads: counts.data?.relatedThreads,
    marks: marks.data?.length,
  };
  return (
    <div className="@container/workspace flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div
        role="tablist"
        aria-label="Workspace sections"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2"
      >
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            aria-label={sectionCounts[id] === undefined ? label : `${label} ${sectionCounts[id]}`}
            className="shrink-0 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted aria-selected:bg-muted aria-selected:text-foreground"
            onClick={() => useRightPanelStore.getState().setWorkspaceSection(threadRef, id)}
          >
            {label}
            {sectionCounts[id] !== undefined ? (
              <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-3xs tabular-nums text-muted-foreground">
                {sectionCounts[id]}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {!startedThread ? (
        <p className="p-5 text-sm text-muted-foreground">
          Send the first message to start this conversation's workspace.
        </p>
      ) : !supported ? (
        <p className="p-5 text-sm text-muted-foreground">
          Connect to a T3 Code build with workspace support.
        </p>
      ) : !canRead ? (
        <p className="p-5 text-sm text-muted-foreground">
          This connection cannot read the workspace.
        </p>
      ) : section === "notes" ? (
        <NotesPanel environmentId={threadRef.environmentId} threadId={threadRef.threadId} />
      ) : (
        <WorkspaceContent
          key={`${threadRef.environmentId}:${threadRef.threadId}`}
          threadRef={threadRef}
          visible={visible}
          section={section}
        />
      )}
    </div>
  );
}

function WorkspaceContent({
  threadRef,
  visible,
  section,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
  readonly section: ThreadWorkspaceSection;
}) {
  const key = `${threadRef.environmentId}:${threadRef.threadId}`;
  const query = useEnvironmentQuery(
    visible
      ? threadWorkspaceGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const save = useAtomCommand(threadWorkspaceSaveDraft, { reportFailure: false });
  const patch = useAtomCommand(threadWorkspacePatch, { reportFailure: false });
  const canWrite = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const [saved, setSaved] = useState<ThreadWorkspace | null>(null);
  const workspace =
    saved && (!query.data || saved.revision > query.data.revision) ? saved : query.data;
  const local = useLocalDrafts((state) => state.entries[key]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const saveQueue = useRef<Promise<ThreadWorkspace | null>>(Promise.resolve(null));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Receives server drafts without replacing unsaved local edits during polling.
  useEffect(() => {
    if (workspace) {
      useLocalDrafts.getState().receive(key, workspace.userDraft, workspace.revision);
    }
  }, [key, workspace]);
  const draft = local?.draft ?? workspace?.userDraft;
  const saveLatestDraft = useStableCallback(async (): Promise<ThreadWorkspace | null> => {
    const entry = useLocalDrafts.getState().entries[key];
    if (!entry?.dirty) return workspace ?? null;
    const result = await save({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        expectedRevision: entry.baseRevision,
        userDraft: entry.draft,
      },
    });
    if (result._tag !== "Success") {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save answers. Your local edits are retained.",
      );
      return null;
    }

    setSaved(result.value);
    useLocalDrafts.getState().saved(key, entry.generation, result.value.revision);
    return result.value;
  });
  const persistDraft = useStableCallback((): Promise<ThreadWorkspace | null> => {
    const operation = saveQueue.current.then(saveLatestDraft);
    saveQueue.current = operation;
    return operation;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Debounces user-authored drafts; server refreshes never trigger a write.
  useEffect(() => {
    if (!local?.dirty || !canWrite || busy) return;
    const timer = setTimeout(() => {
      void persistDraft();
    }, 700);
    return () => clearTimeout(timer);
  }, [local, canWrite, busy, persistDraft]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Flushes the final user edit when switching away from this thread.
  useEffect(
    () => () => {
      void persistDraft();
    },
    [persistDraft],
  );
  const edit = (next: WorkspaceUserDraft) => {
    useLocalDrafts.getState().edit(key, next);
    setSent([]);
  };
  const send = async (itemIds: string[]) => {
    if (busy || !canWrite) return;
    setBusy(true);
    setError(null);
    const current = await persistDraft();
    if (current) {
      const ids = itemIds.length ? itemIds : readyWorkspaceFeedbackIds(current);
      const invalid = workspaceDraftError(current, {
        questionAnswers: Object.fromEntries(
          Object.entries(current.userDraft.questionAnswers).filter(([id]) => ids.includes(id)),
        ),
        actionNotes: {},
      });
      if (invalid) {
        setError(invalid);
        setBusy(false);
        return;
      }
      const feedback = formatWorkspaceFeedback(threadRef, current, ids);
      const composer = useComposerDraftStore.getState();
      const existing = composer.draftsByThreadKey[scopedThreadKey(threadRef)]?.prompt ?? "";
      composer.addThreadContexts(threadRef, feedback.records, { appendReference: false });
      const additions = ids
        .map((id) => formatWorkspaceFeedback(threadRef, current, [id]).markdown)
        .filter((markdown) => markdown && !existing.includes(markdown));
      if (additions.length) {
        composer.setPrompt(threadRef, [existing, ...additions].filter(Boolean).join("\n\n"));
      }
      setSent(ids);
    }
    setBusy(false);
    query.refresh();
  };
  const changeStatus = async (item: ThreadActionItem) => {
    if (!workspace || busy) return;
    setBusy(true);
    setError(null);
    const current = await persistDraft();
    if (!current) {
      setBusy(false);
      return;
    }
    const result = await patch({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        expectedRevision: current.revision,
        actionItems: current.actionItems.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: item.status === "done" ? "open" : "done" }
            : entry,
        ),
      },
    });
    if (result._tag === "Success") {
      setSaved(result.value);
      useLocalDrafts.getState().rebase(key, result.value.revision);
    } else {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not update action.");
    }
    setBusy(false);
    query.refresh();
  };
  if (!workspace || !draft)
    return (
      <p className="p-5 text-sm text-muted-foreground">
        {query.error ? String(query.error) : "Loading workspace…"}
      </p>
    );
  if (section === "marks")
    return <WorkspaceMarksPanel threadRef={threadRef} annotations={workspace.markAnnotations} />;
  if (section === "threads")
    return <WorkspaceThreadsPanel threadRef={threadRef} related={workspace.relatedThreads} />;
  const ready = readyWorkspaceFeedbackIds({ ...workspace, userDraft: draft }).length > 0;
  return (
    <>
      {error || query.error ? (
        <div
          role="alert"
          className="shrink-0 border-b border-destructive/30 p-3 text-xs text-destructive"
        >
          {error ?? String(query.error)}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setError(null);
              query.refresh();
            }}
          >
            Refresh
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              if (query.data) {
                useLocalDrafts.getState().reset(key, query.data.userDraft, query.data.revision);
                setSaved(query.data);

                setError(null);
              }
            }}
          >
            Reload saved answers
          </Button>
        </div>
      ) : null}
      <WorkspaceDocument
        threadRef={threadRef}
        section={section}
        workspace={workspace}
        renderQuestion={(question) => (
          <WorkspaceQuestionCard
            key={question.id}
            question={question}
            threadRef={threadRef}
            answer={draft.questionAnswers[question.id] ?? emptyAnswer}
            disabled={!canWrite || busy}
            sent={sent.includes(question.id)}
            onChange={(answer) =>
              edit({
                ...draft,
                questionAnswers: { ...draft.questionAnswers, [question.id]: answer },
              })
            }
            onSend={() => {
              void send([question.id]);
            }}
          />
        )}
        renderAction={(action) => (
          <details
            key={action.id}
            id={`workspace-item-${action.id}`}
            className="group rounded-lg border border-border p-3"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
              <ChevronRightIcon className="size-3 shrink-0 group-open:rotate-90" />
              <span className="text-3xs text-muted-foreground">{action.ref}</span>
              <span
                className={action.status === "done" ? "line-through text-muted-foreground" : ""}
              >
                {action.title}
              </span>
              {action.status === "done" ? (
                <CheckIcon className="ml-auto size-3 text-primary" />
              ) : null}
            </summary>
            <div className="mt-3 space-y-3">
              {action.details ? (
                <ChatMarkdown text={action.details} cwd={undefined} threadRef={threadRef} />
              ) : null}
              <Textarea
                aria-label={`Notes for ${action.title}`}
                placeholder="Your notes…"
                value={draft.actionNotes[action.id] ?? ""}
                disabled={!canWrite}
                onChange={(event) =>
                  edit({
                    ...draft,
                    actionNotes: { ...draft.actionNotes, [action.id]: event.target.value },
                  })
                }
              />
              <div className="flex gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canWrite || busy}
                  onClick={() => {
                    void changeStatus(action);
                  }}
                >
                  {action.status === "done" ? "Reopen" : "Mark done"}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!canWrite || busy}
                  onClick={() => {
                    void send([action.id]);
                  }}
                >
                  <SendIcon className="size-3" />
                  Add to chat
                </Button>
              </div>
            </div>
          </details>
        )}
      />
      {section === "questions" || section === "action-items" || section === "unified" ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-3xs text-muted-foreground">
            {local?.dirty
              ? "Saving answers…"
              : "Add responses to the composer, then send when ready."}
          </span>
          <Button
            size="xs"
            disabled={!canWrite || busy || !ready}
            onClick={() => {
              void send([]);
            }}
          >
            <SendIcon className="size-3" />
            Add ready responses to chat
          </Button>
        </div>
      ) : null}
    </>
  );
}
