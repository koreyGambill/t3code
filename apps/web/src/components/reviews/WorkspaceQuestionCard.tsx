import type {
  ScopedThreadRef,
  WorkspaceQuestion,
  WorkspaceQuestionAnswer,
} from "@t3tools/contracts";
import { ChevronRightIcon, CheckIcon, SendIcon } from "lucide-react";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
export function WorkspaceQuestionCard({
  question,
  threadRef,
  answer,
  disabled,
  sent,
  onChange,
  onSend,
}: {
  readonly question: WorkspaceQuestion;
  readonly threadRef: ScopedThreadRef;
  readonly answer: WorkspaceQuestionAnswer;
  readonly disabled: boolean;
  readonly sent: boolean;
  readonly onChange: (answer: WorkspaceQuestionAnswer) => void;
  readonly onSend: () => void;
}) {
  const retired = answer.selectedOptionIds.filter(
    (id) => !question.options.some((option) => option.id === id),
  );
  const selectionModeChanged = !question.multiSelect && answer.selectedOptionIds.length > 1;
  const ready = answer.selectedOptionIds.length > 0 || Boolean(answer.notes.trim());
  return (
    <details
      id={`workspace-item-${question.id}`}
      className="group rounded-lg border border-border p-3"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
        <ChevronRightIcon className="size-3 shrink-0 group-open:rotate-90" />
        <span className="text-3xs text-muted-foreground">{question.ref}</span>
        <span className="font-medium">{question.title}</span>
        {ready ? <CheckIcon className="ml-auto size-3 shrink-0 text-primary" /> : null}
      </summary>
      <div className="mt-3 space-y-3">
        {question.details ? (
          <ChatMarkdown text={question.details} cwd={undefined} threadRef={threadRef} />
        ) : null}
        {retired.length ? (
          <div className="space-y-2 rounded border border-border bg-muted/30 p-3 text-xs">
            <p>
              Some earlier choices are no longer available. Your answer is retained until you remove
              them.
            </p>
            {retired.map((id) => (
              <div key={id} className="flex items-center justify-between gap-2">
                <code className="min-w-0 truncate">{id}</code>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                  aria-label={`Remove unavailable choice ${id}`}
                  onClick={() =>
                    onChange({
                      ...answer,
                      selectedOptionIds: answer.selectedOptionIds.filter(
                        (selected) => selected !== id,
                      ),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {selectionModeChanged ? (
          <p className="text-xs text-muted-foreground">
            This question now allows one choice. Select one option or remove earlier choices before
            sending.
          </p>
        ) : null}
        <div
          role="group"
          aria-label={question.multiSelect ? "Select any answers" : "Select one answer"}
          className="flex flex-wrap gap-2"
        >
          {question.options.map((option) => {
            const selected = answer.selectedOptionIds.includes(option.id);
            const recommended = question.recommendedOptionIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}

                disabled={disabled}
                className="rounded-md border border-border px-3 py-2 text-left text-xs aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary disabled:opacity-50"
                onClick={() =>
                  onChange({
                    ...answer,
                    selectedOptionIds: selected
                      ? answer.selectedOptionIds.filter((id) => id !== option.id)
                      : question.multiSelect
                        ? [...answer.selectedOptionIds, option.id]
                        : [option.id],
                  })
                }
              >
                {option.label}
                {recommended ? (
                  <span className="ml-2 text-3xs text-primary">Recommended</span>
                ) : null}
                {option.description ? (
                  <span className="mt-1 block text-3xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {question.recommendation ? (
          <p className="border-l-2 border-primary/50 pl-3 text-xs text-muted-foreground">
            <span className="font-medium text-primary">Recommendation: </span>
            {question.recommendation}
          </p>
        ) : null}
        <Textarea
          aria-label={`Answer to ${question.title}`}
          placeholder="Your answer or notes…"
          value={answer.notes}
          disabled={disabled}
          onChange={(event) => onChange({ ...answer, notes: event.target.value })}
        />
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled || !ready || retired.length > 0 || selectionModeChanged}
          onClick={onSend}
        >
          <SendIcon className="size-3" />
          {sent ? "Added to chat" : "Add to chat"}
        </Button>
      </div>
    </details>
  );
}
