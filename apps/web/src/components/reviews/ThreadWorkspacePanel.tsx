import {
  AuthOrchestrationReadScope,
  type ArtifactAnswerContextRecord,
  type ArtifactQuestion,
  type ScopedThreadRef,
  type ThreadArtifact,
  type ThreadArtifactVersion,
  type ThreadWorkspace,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { toComposerContextId } from "@t3tools/shared/composerContextReferences";
import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/models";
import { environmentThreadDetails } from "../../state/threads";
import { useWorkspaceMutationRefresh } from "../../hooks/useWorkspaceMutationRefresh";
import { randomUUID } from "../../lib/utils";
import { useComposerDraftStore, type ComposerThreadTarget } from "../../composerDraftStore";
import type { ThreadWorkspaceSection } from "../../rightPanelStore";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadWorkspaceGet, threadArtifactAnswer } from "../../state/threadWorkspace";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { ThreadListView, ThreadListSummary, YourQaView } from "./ThreadListView";

type AnswerDraft = { chosenOptionIds: readonly string[]; notes: string };
export function ThreadWorkspacePanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly composerDraftTarget?: ComposerThreadTarget;
  readonly surfaceId?: string;
  readonly workspaceMutationId?: string | null;
  readonly reviewId: string | null;
  readonly visible: boolean;
  readonly startedThread: boolean;
  readonly section: ThreadWorkspaceSection;
}) {
  if (!props.visible) return null;
  if (props.section === "list") return <ThreadListView threadRef={props.threadRef} />;
  if (props.section === "qa") return <YourQaView threadRef={props.threadRef} />;
  if (props.section === "summary") return <ThreadListSummary threadRef={props.threadRef} />;
  return (
    <ArtifactsPanel
      key={`${props.threadRef.environmentId}:${props.threadRef.threadId}:${props.reviewId ?? ""}`}
      threadRef={props.threadRef}
      selectedId={props.reviewId}
      workspaceMutationId={props.workspaceMutationId ?? null}
      composerDraftTarget={props.composerDraftTarget ?? props.threadRef}
    />
  );
}

const latestUserMessageId = (items: readonly ThreadStructureVisibleTurnItem[]) =>
  items.findLast((entry) => entry.item.type === "user_message")?.item.id ?? null;

function ArtifactsPanel({
  threadRef,
  selectedId,
  workspaceMutationId,
  composerDraftTarget,
}: {
  threadRef: ScopedThreadRef;
  selectedId: string | null;
  workspaceMutationId: string | null;
  composerDraftTarget: ComposerThreadTarget;
}) {
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    canRead
      ? threadWorkspaceGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const userMessageId = useAtomValue(
    environmentThreadDetails.quietVisibleTurnItemsAtom(threadRef),
    latestUserMessageId,
  );
  useWorkspaceMutationRefresh({
    enabled: canRead,
    mutationId: [workspaceMutationId, userMessageId].filter(Boolean).join(":") || null,
    resourceKey: `${threadRef.environmentId}:${threadRef.threadId}:artifacts`,
    refresh: query.refresh,
  });
  const [updated, setUpdated] = useState<ThreadWorkspace | null>(null);
  const workspace =
    updated && updated.revision > (query.data?.revision ?? 0) ? updated : query.data;
  const [selected, setSelected] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const canAnswer = useAtomValue(threadArtifactAnswer.permissionAtom(threadRef.environmentId));
  const artifact =
    workspace?.artifacts.find((entry) => entry.id === (selected ?? selectedId)) ??
    workspace?.artifacts[0];
  const version =
    artifact?.versions.find((entry) => entry.version === versionNumber) ??
    artifact?.versions.at(-1);
  const ready =
    workspace?.artifacts.flatMap((entry) => {
      const latest = entry.versions.at(-1);
      return latest
        ? latest.questions.flatMap((question): ArtifactAnswerContextRecord[] => {
            const answer = latest.answers[question.id];
            if (
              !answer ||
              answer.submittedAt ||
              (!answer.chosenOptionIds.length && !answer.notes.trim())
            )
              return [];
            return [
              {
                version: 1,
                kind: "artifact-answer",
                contextId: toComposerContextId(
                  `answer_${threadRef.threadId}:${entry.id}:${latest.version}:${question.id}:${answer.draftRevision ?? 0}`,
                ),
                label: `${latest.title}: ${question.prompt}`.slice(0, 200),
                artifactId: entry.id,
                title: latest.title.slice(0, 200),
                artifactVersion: latest.version,
                questionId: question.id,
                answerRevision: answer.draftRevision ?? 0,
                question: question.prompt,
                choice: question.options
                  .filter((option) => answer.chosenOptionIds.includes(option.id))
                  .map((option) => option.label)
                  .join(", "),
                note: answer.notes,
              },
            ];
          })
        : [];
    }) ?? [];
  const send = () => {
    useComposerDraftStore.getState().addArtifactAnswers(composerDraftTarget, ready);
    setNotice(
      `${ready.length} answer${ready.length === 1 ? "" : "s"} added to the composer. Send your message there.`,
    );
  };
  if (!workspace) return <p role="status">{query.error ?? "Loading artifacts…"}</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">Artifacts</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {workspace.artifacts.map((entry) => (
          <Button
            key={entry.id}
            size="sm"
            variant={artifact?.id === entry.id ? "secondary" : "ghost"}
            onClick={() => {
              setSelected(entry.id);
              setVersionNumber(null);
            }}
          >
            {entry.title}
          </Button>
        ))}
      </div>
      {artifact && version ? (
        <>
          <div className="flex items-center gap-2">
            <h4 className="flex-1 text-sm font-medium">{version.title}</h4>
            <select
              aria-label="Artifact version"
              value={version.version}
              onChange={(event) => setVersionNumber(Number(event.target.value))}
            >
              {artifact.versions.toReversed().map((entry) => (
                <option key={entry.version} value={entry.version}>
                  Version {entry.version} · {new Date(entry.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
          <ArtifactDocument
            key={`${artifact.id}:${version.version}`}
            artifact={artifact}
            version={version}
            workspace={workspace}
            threadRef={threadRef}
            composerDraftTarget={composerDraftTarget}
            onRefresh={query.refresh}
            onSaved={(next) => {
              setUpdated(next);
              query.refresh();
            }}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No artifacts yet.</p>
      )}
      <div className="flex items-center gap-2 border-t pt-3">
        <Button size="sm" disabled={!ready.length || !canAnswer} onClick={send}>
          Send {ready.length || ""} queued {ready.length === 1 ? "answer" : "answers"} to composer
        </Button>
      </div>
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function ArtifactDocument({
  artifact,
  version,
  workspace,
  threadRef,
  composerDraftTarget,
  onSaved,
  onRefresh,
}: {
  artifact: ThreadArtifact;
  version: ThreadArtifactVersion;
  workspace: ThreadWorkspace;
  threadRef: ScopedThreadRef;
  composerDraftTarget: ComposerThreadTarget;
  onSaved: (next: ThreadWorkspace) => void;
  onRefresh: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const save = useAtomCommand(threadArtifactAnswer);
  const canAnswer = useAtomValue(threadArtifactAnswer.permissionAtom(threadRef.environmentId));
  const latest = artifact.versions.at(-1)?.version === version.version;
  const question = (entry: ArtifactQuestion) => {
    const answer = drafts[entry.id] ??
      version.answers[entry.id] ?? { chosenOptionIds: [], notes: "" };
    const edit = (change: Partial<AnswerDraft>) =>
      setDrafts({ ...drafts, [entry.id]: { ...answer, ...change } });
    return (
      <fieldset
        key={entry.id}
        className="space-y-2 rounded border border-border p-3"
        disabled={!latest || !canAnswer || busy}
      >
        <legend className="text-sm font-medium">{entry.prompt}</legend>
        {entry.details ? (
          <ChatMarkdown text={entry.details} cwd={undefined} threadRef={threadRef} />
        ) : null}
        {entry.options.map((option) => (
          <label key={option.id} className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={answer.chosenOptionIds.includes(option.id)}
              onCheckedChange={(checked) =>
                edit({
                  chosenOptionIds: entry.multiSelect
                    ? checked
                      ? [...answer.chosenOptionIds, option.id]
                      : answer.chosenOptionIds.filter((id) => id !== option.id)
                    : checked
                      ? [option.id]
                      : [],
                })
              }
            />
            <span>
              {option.label}
              {entry.recommendedOptionIds.includes(option.id) ? " (Recommended)" : ""}
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
        <Textarea
          aria-label={`Notes for ${entry.prompt}`}
          value={answer.notes}
          onChange={(event) => edit({ notes: event.target.value })}
        />
        {version.answers[entry.id]?.submittedAt && !drafts[entry.id] ? (
          <p className="text-xs text-muted-foreground">Sent to chat</p>
        ) : null}
      </fieldset>
    );
  };
  const parts = version.content
    .split(/^```t3-question[^\S\r\n]*\r?\n[\s\S]*?^```[^\S\r\n]*\r?$/gm)
    .map((part, index) => ({ part, entry: version.questions[index] }));
  return (
    <div className="space-y-3">
      {version.format === "html" ? (
        <iframe
          title={version.title}
          sandbox=""
          srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:"><style>body{font:14px system-ui;color-scheme:light dark;margin:16px}</style>${version.content}`}
          className="h-96 w-full rounded border border-border"
        />
      ) : (
        parts.map(({ part, entry }) => (
          <div key={entry ? `question:${entry.id}` : "tail"} className="space-y-3">
            {part.trim() ? (
              <ChatMarkdown text={part} cwd={undefined} threadRef={threadRef} />
            ) : null}
            {entry ? question(entry) : null}
          </div>
        ))
      )}
      {latest && version.questions.length ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!Object.keys(drafts).length || busy || !canAnswer}
          onClick={async () => {
            setBusy(true);
            {
              const result = await save({
                environmentId: threadRef.environmentId,
                input: {
                  threadId: threadRef.threadId,
                  id: artifact.id,
                  version: version.version,
                  expectedRevision: workspace.revision,
                  answers: Object.fromEntries(
                    Object.entries(drafts).map(([id, answer]) => [
                      id,
                      { ...answer, submittedAt: null },
                    ]),
                  ),
                },
              });
              if (result._tag === "Success") {
                onSaved(result.value);
                setDrafts({});
              }
            }
            onRefresh();
            setBusy(false);
          }}
        >
          Queue answers
        </Button>
      ) : null}
      <Textarea
        aria-label="Artifact review comment"
        placeholder="Add a review comment…"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!comment.trim() || !canAnswer}
        onClick={() => {
          useComposerDraftStore.getState().addReviewComment(composerDraftTarget, {
            id: randomUUID(),
            sectionId: artifact.id,
            sectionTitle: version.title.slice(0, 200),
            filePath: `artifact:${artifact.id}@${version.version}`,
            startIndex: 0,
            endIndex: 0,
            rangeLabel: `Version ${version.version}`,
            text: comment,
            diff: version.content.slice(0, 16000),
            fenceLanguage: version.format,
          });
          setComment("");
        }}
      >
        Add comment to composer
      </Button>
    </div>
  );
}
