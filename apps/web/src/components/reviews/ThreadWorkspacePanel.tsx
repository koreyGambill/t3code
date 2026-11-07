import {
  AuthOrchestrationReadScope,
  type ScopedThreadRef,
  type ThreadWorkspace,
  type WorkspaceQuestionAnswer,
  type WorkspaceMutation,
  type WorkspaceUserDraft,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
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
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Textarea } from "../ui/textarea";
import { threadMarksGet } from "../../state/threadMarks";
import { useReviewSupport } from "./useReviewSupport";
import { WorkspaceMarksPanel } from "./WorkspaceMarksPanel";
import { WorkspaceThreadsPanel } from "./WorkspaceThreadsPanel";
import { WorkspaceDocument } from "./WorkspaceDocument";
import { WorkspaceQuestionCard } from "./WorkspaceQuestionCard";
import { AgentWorkList, WorkspaceRecordList } from "./WorkspaceRecordViews";
import { WorkspaceAllWork } from "./WorkspaceAllWork";
import { WorkspaceChildPreamble } from "./WorkspaceChildPreamble";

const sections = [
  ["unified", "Unified"],
  ["questions", "Questions"],
  ["action-items", "Action items"],
  ["design-notes", "Design"],
  ["agent-work", "Agent work"],
  ["record", "Record"],
  ["summary", "Summary"],
  ["marks", "Marks"],
  ["threads", "Threads"],
] as const;
const emptyAnswer: WorkspaceQuestionAnswer = { selectedOptionIds: [], notes: "" };
const noDraft: WorkspaceUserDraft = { questionAnswers: {}, actionNotes: {} };
// Only entries the user edited are kept and sent, so the server merges them per entry.
interface LocalDraft {
  readonly pending: WorkspaceUserDraft;
  readonly baseRevision: number;
}
const isEmptyDraft = (draft: WorkspaceUserDraft) =>
  !Object.keys(draft.questionAnswers).length && !Object.keys(draft.actionNotes).length;
const useLocalDrafts = create<{
  entries: Record<string, LocalDraft>;
  edit: (key: string, change: Partial<WorkspaceUserDraft>, revision: number) => void;
  reset: (key: string) => void;
  saved: (key: string, sent: WorkspaceUserDraft) => void;
}>((set) => ({
  entries: {},
  edit: (key, change, revision) =>
    set((state) => {
      const current = state.entries[key];
      const pending = current?.pending ?? noDraft;
      return {
        entries: {
          ...state.entries,
          [key]: {
            pending: {
              questionAnswers: { ...pending.questionAnswers, ...change.questionAnswers },
              actionNotes: { ...pending.actionNotes, ...change.actionNotes },
            },
            baseRevision: current && !isEmptyDraft(pending) ? current.baseRevision : revision,
          },
        },
      };
    }),
  reset: (key) =>
    set((state) => {
      const { [key]: _removed, ...entries } = state.entries;
      return { entries };
    }),
  saved: (key, sent) =>
    set((state) => {
      const current = state.entries[key];
      if (!current) return state;
      const unsent = <T,>(pending: Record<string, T>, done: Record<string, T>) =>
        Object.fromEntries(
          Object.entries(pending).filter(
            ([id, value]) => JSON.stringify(done[id]) !== JSON.stringify(value),
          ),
        );
      const pending = {
        questionAnswers: unsent(current.pending.questionAnswers, sent.questionAnswers),
        actionNotes: unsent(current.pending.actionNotes, sent.actionNotes),
      };
      if (isEmptyDraft(pending)) {
        const { [key]: _removed, ...entries } = state.entries;
        return { entries };
      }
      return { entries: { ...state.entries, [key]: { ...current, pending } } };
    }),
}));

export function ThreadWorkspacePanel({
  threadRef,
  surfaceId,
  visible,
  startedThread,
  section: storedSection,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly surfaceId?: string;
  readonly reviewId: string | null;
  readonly visible: boolean;
  readonly startedThread: boolean;
  readonly section: ThreadWorkspaceSection;
}) {
  const [workScope, setWorkScope] = useState("thread");
  const section = storedSection === "notes" ? "unified" : storedSection;
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
    "agent-work": counts.data?.openAgentWork,
    record: counts.data?.records,
    "action-items": counts.data?.actions,
    "design-notes": counts.data?.designs,
    threads: counts.data?.relatedThreads,
    marks: marks.data?.length,
  };
  return (
    <div className="@container/workspace relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div
        role="tablist"
        aria-label="Workspace sections"
        className={`flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border pl-1 ${section === "marks" ? "workspace-area-tabs-with-tools" : "pr-14"}`}
      >
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            aria-label={sectionCounts[id] === undefined ? label : `${label} ${sectionCounts[id]}`}
            className="shrink-0 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted aria-selected:bg-muted aria-selected:text-foreground"
            onClick={() =>
              useRightPanelStore.getState().setWorkspaceSection(threadRef, id, surfaceId)
            }
          >
            {label}
            {sectionCounts[id] !== undefined ? (
              <span className="ml-1 rounded bg-muted px-1 text-3xs tabular-nums text-muted-foreground">
                {sectionCounts[id]}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {section === "agent-work" ? (
        <label className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
          Scope
          <select
            aria-label="Agent work scope"
            value={workScope}
            onChange={(event) => setWorkScope(event.target.value)}
            className="rounded border border-input bg-background px-1"
          >
            <option value="thread">This thread</option>
            <option value="all">All threads and machines</option>
          </select>
        </label>
      ) : null}
      {section === "agent-work" && workScope === "all" ? (
        <WorkspaceAllWork />
      ) : !startedThread ? (
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
  const canWrite = useAtomValue(threadWorkspacePatch.permissionAtom(threadRef.environmentId));
  const [saved, setSaved] = useState<ThreadWorkspace | null>(null);
  const workspace =
    saved && (!query.data || saved.revision > query.data.revision) ? saved : query.data;
  const local = useLocalDrafts((state) => state.entries[key]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const saveQueue = useRef<Promise<ThreadWorkspace | null>>(Promise.resolve(null));
  const draft = workspace && {
    questionAnswers: {
      ...workspace.userDraft.questionAnswers,
      ...local?.pending.questionAnswers,
    },
    actionNotes: { ...workspace.userDraft.actionNotes, ...local?.pending.actionNotes },
  };
  const saveLatestDraft = useStableCallback(async (): Promise<ThreadWorkspace | null> => {
    const entry = useLocalDrafts.getState().entries[key];
    if (!entry) return workspace ?? null;
    const result = await save({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        expectedRevision: entry.baseRevision,
        userDraft: entry.pending,
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
    useLocalDrafts.getState().saved(key, entry.pending);
    return result.value;
  });
  const persistDraft = useStableCallback((): Promise<ThreadWorkspace | null> => {
    const operation = saveQueue.current.then(saveLatestDraft);
    saveQueue.current = operation;
    return operation;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Debounces user-authored drafts; server refreshes never trigger a write.
  useEffect(() => {
    if (!local || !canWrite || busy) return;
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
  const edit = (change: Partial<WorkspaceUserDraft>) => {
    if (!workspace) return;
    useLocalDrafts.getState().edit(key, change, workspace.revision);
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
  const apply = async (changes: WorkspaceMutation[], fields: { childPreamble?: string } = {}) => {
    if (!workspace || busy) return;
    setBusy(true);
    setError(null);
    const result = await patch({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        expectedRevision: workspace.revision,
        changes,
        ...fields,
      },
    });
    if (result._tag === "Success") setSaved(result.value);
    else {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not update the workspace.");
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
  if (section === "agent-work")
    return (
      <AgentWorkList
        workspace={workspace}
        disabled={!canWrite || busy}
        apply={(changes) => {
          void apply(changes);
        }}
      />
    );
  const recordView =
    section === "record" ? (
      <>
        <WorkspaceChildPreamble
          value={workspace.childPreamble}
          disabled={!canWrite || busy}
          onSave={(childPreamble) => {
            void apply([], { childPreamble });
          }}
        />
        <WorkspaceRecordList
          workspace={workspace}
          disabled={!canWrite || busy}
          apply={(changes) => {
            void apply(changes);
          }}
        />
      </>
    ) : null;
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
              useLocalDrafts.getState().reset(key);
              setError(null);
              query.refresh();
            }}
          >
            Reload saved answers
          </Button>
        </div>
      ) : null}
      {recordView ?? (
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
              onChange={(answer) => edit({ questionAnswers: { [question.id]: answer } })}
              onSend={() => {
                void send([question.id]);
              }}
            />
          )}
          renderAction={(action) => (
            <details
              key={action.id}
              id={`workspace-item-${action.id}`}
              className="group rounded border border-border p-2"
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
                  onChange={(event) => edit({ actionNotes: { [action.id]: event.target.value } })}
                />
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canWrite || busy}
                    onClick={() => {
                      void apply([
                        {
                          kind: "action",
                          id: action.id,
                          status: action.status === "done" ? "open" : "done",
                        },
                      ]);
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
      )}
      {section === "questions" || section === "action-items" || section === "unified" ? (
        <div className="absolute right-7 top-0 z-10 flex h-7 items-center bg-background px-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost"
                  aria-label="Add ready responses to chat"
                  disabled={!canWrite || busy || !ready}
                  onClick={() => {
                    void send([]);
                  }}
                />
              }
            >
              <SendIcon />
            </TooltipTrigger>
            <TooltipPopup>{local ? "Saving answers…" : "Add ready responses to chat"}</TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
    </>
  );
}
