import {
  AuthEnvironmentMaintainScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { CircleHelpIcon, EyeIcon, PencilIcon, SendIcon, SettingsIcon } from "lucide-react";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import {
  threadNoteGet,
  threadNotesSettings,
  updateThreadNotesSettings,
} from "../../state/threadNotes";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ChatMarkdown from "../ChatMarkdown";
import { randomUUID } from "../../lib/utils";
import { useComposerDraftStore } from "../../composerDraftStore";
import { editNote, flushNote, receiveNote, retryNote, useNoteDraft } from "./noteDraft";

export function NotesPanel({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    canRead ? threadNoteGet({ environmentId, input: { threadId } }) : null,
  );
  const settings = useEnvironmentQuery(
    canRead ? threadNotesSettings({ environmentId, input: {} }) : null,
  );
  const draft = useNoteDraft(environmentId, threadId);
  const canWrite = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canConfigure = useEnvironmentScope(environmentId, AuthEnvironmentMaintainScope);
  const updateSettings = useAtomCommand(updateThreadNotesSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [directory, setDirectory] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Server refreshes reconcile only clean drafts; unsaved edits survive panel navigation.
  useEffect(() => {
    if (query.data) receiveNote(environmentId, query.data);
  }, [environmentId, query.data]);
  async function shareSelection() {
    const selectedText = draft?.text.slice(selection.start, selection.end);
    setSending(true);
    setError(null);
    try {
      await flushNote(environmentId, threadId);
      const note = await flushNote(environmentId, threadId);
      if (!note.revision) {
        setError("Save the note before sharing it.");
      } else if (
        !selectedText ||
        note.text.slice(selection.start, selection.end) !== selectedText
      ) {
        setError("The selected text changed while saving. Select it again before sharing.");
      } else {
        useComposerDraftStore.getState().addReviewComment(
          { environmentId, threadId },
          {
            id: `note-${randomUUID()}`,
            sectionId: `note-${threadId}`,
            sectionTitle: "Personal note",
            filePath: note.path,
            startIndex: selection.start,
            endIndex: selection.end,
            rangeLabel: `Selected note text (${selection.start}-${selection.end})`,
            text: selectedText,
            diff: "",
          },
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add the selection to the composer.",
      );
    }
    setSending(false);
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Personal notes</h2>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={viewing ? "Edit notes" : "View notes"}
                  disabled={!draft || sending}
                  onClick={() => {
                    setSelection({ start: 0, end: 0 });
                    setViewing(!viewing);
                  }}
                />
              }
            >
              {viewing ? <PencilIcon /> : <EyeIcon />}
            </TooltipTrigger>
            <TooltipPopup>{viewing ? "Edit notes" : "View notes"}</TooltipPopup>
          </Tooltip>
          <Popover>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={<Button variant="ghost" size="icon-sm" aria-label="Notes help" />}
                  />
                }
              >
                <CircleHelpIcon />
              </TooltipTrigger>
              <TooltipPopup>Notes help</TooltipPopup>
            </Tooltip>
            <PopoverPopup align="end" width="md">
              <div className="space-y-3 text-xs text-muted-foreground">
                <p>Notes stay private until you add selected text to chat.</p>
                {draft && (
                  <>
                    <p className="break-all select-text">{draft.note.path}</p>
                    {draft.note.resumeCommand && (
                      <code className="block break-all select-text">
                        {draft.note.resumeCommand}
                      </code>
                    )}
                    <p>{draft.note.resumeExplanation}</p>
                  </>
                )}
              </div>
            </PopoverPopup>
          </Popover>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Notes directory"
                  disabled={sending}
                  onClick={() => {
                    setDirectory(settings.data?.directory ?? "");
                    setShowSettings(!showSettings);
                  }}
                />
              }
            >
              <SettingsIcon />
            </TooltipTrigger>
            <TooltipPopup>Notes directory</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      {showSettings && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <label className="text-xs" htmlFor="notes-directory">
            Notes directory on this environment
          </label>
          <Input
            id="notes-directory"
            disabled={sending}
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="About notes directories" />
              }
            >
              <CircleHelpIcon />
            </TooltipTrigger>
            <TooltipPopup>
              Opens notes in the new directory. Existing files stay where they are.
            </TooltipPopup>
          </Tooltip>
          <Button
            variant="outline"
            size="sm"
            disabled={!canConfigure || sending}
            onClick={async () => {
              const result = await updateSettings({ environmentId, input: { directory } });
              if (result._tag === "Failure") {
                setError(
                  "Could not set the notes directory. Use an absolute path on this environment.",
                );
                return;
              }
              settings.refresh();
              query.refresh();
              setShowSettings(false);
            }}
          >
            Use directory
          </Button>
        </div>
      )}
      {(query.error || error || draft?.error) && (
        <div role="alert" className="rounded-lg border border-destructive p-3 text-sm">
          <p>{draft?.error ?? error ?? query.error}</p>
          {draft?.error && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void retryNote(environmentId, threadId).catch(() => {});
              }}
            >
              Retry save
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              if (query.data) receiveNote(environmentId, query.data, true);
              query.refresh();
            }}
          >
            Reload saved note
          </Button>
          <p className="mt-2 text-xs">Copy your unsaved text before reloading.</p>
        </div>
      )}
      {draft ? (
        <>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.includeThreadId}
                disabled={!canWrite || sending}
                onChange={(event) =>
                  editNote(environmentId, threadId, { includeThreadId: event.target.checked })
                }
              />
              Include thread ID in file
            </label>
            <span>{draft.saving ? "Saving…" : draft.dirty ? "Unsaved" : "Saved"}</span>
          </div>
          <div className="flex min-h-64 flex-1 flex-col">
            {viewing ? (
              <div aria-label="Notes preview" className="min-h-64 flex-1">
                {draft.text ? (
                  <ChatMarkdown text={draft.text} cwd={undefined} environmentId={environmentId} />
                ) : (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                )}
              </div>
            ) : (
              <Textarea
                ref={editor}
                aria-label="Personal thread notes"
                value={draft.text}
                disabled={!canWrite || sending}
                className="min-h-64 flex-1"
                placeholder="Write your own notes in Markdown…"
                onChange={(event) =>
                  editNote(environmentId, threadId, { text: event.target.value })
                }
                onSelect={(event) =>
                  setSelection({
                    start: event.currentTarget.selectionStart,
                    end: event.currentTarget.selectionEnd,
                  })
                }
                onBlur={() => {
                  void flushNote(environmentId, threadId).catch(() => {});
                }}
              />
            )}
          </div>
          {!viewing && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={!canWrite || sending || selection.end <= selection.start || !!draft.error}
                onClick={() => void shareSelection()}
              >
                <SendIcon />
                Add selection to chat
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {query.isPending ? "Loading notes…" : "Notes are unavailable."}
        </p>
      )}
    </div>
  );
}
