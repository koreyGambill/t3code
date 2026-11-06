import type { ReviewAnswer, ReviewQuestion, ScopedThreadRef } from "@t3tools/contracts";

import ChatMarkdown from "../ChatMarkdown";
import { Checkbox } from "../ui/checkbox";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Textarea } from "../ui/textarea";

export const emptyReviewAnswer: ReviewAnswer = {
  selectedOptionIds: [],
  notes: "",
  deferred: false,
};

export function ReviewQuestionCard({
  question,
  answer,
  threadRef,
  disabled,
  onChange,
}: {
  readonly question: ReviewQuestion;
  readonly answer: ReviewAnswer;
  readonly threadRef: ScopedThreadRef;
  readonly disabled: boolean;
  readonly onChange: (answer: ReviewAnswer) => void;
}) {
  const options = question.options.map((option) => (
    <label
      key={option.id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[[data-checked]]:border-primary/60 has-[[data-checked]]:bg-primary/5"
    >
      {question.multiSelect ? (
        <Checkbox
          checked={answer.selectedOptionIds.includes(option.id)}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({
              ...answer,
              selectedOptionIds: checked
                ? [...answer.selectedOptionIds, option.id]
                : answer.selectedOptionIds.filter((id) => id !== option.id),
            })
          }
        />
      ) : (
        <Radio value={option.id} disabled={disabled} />
      )}
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {option.label}
          {question.recommendedOptionId === option.id ? (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-normal text-primary">
              Recommended
            </span>
          ) : null}
        </span>
        {option.description ? (
          <span className="block text-xs leading-relaxed text-muted-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
    </label>
  ));
  return (
    <article
      data-review-question={question.id}
      id={`review-question-${question.id}`}
      className="scroll-mt-4 space-y-4 rounded-xl border border-border bg-background p-4"
    >
      <ChatMarkdown text={question.prompt} cwd={undefined} threadRef={threadRef} />
      {question.context ? (
        <div className="text-sm text-muted-foreground">
          <ChatMarkdown text={question.context} cwd={undefined} threadRef={threadRef} />
        </div>
      ) : null}
      {question.recommendation ? (
        <div className="border-l-2 border-primary/50 pl-3 text-sm">
          <p className="mb-1 text-xs font-medium text-primary">Recommendation</p>
          <ChatMarkdown text={question.recommendation} cwd={undefined} threadRef={threadRef} />
        </div>
      ) : null}
      {question.multiSelect ? (
        <div className="space-y-2" role="group" aria-label={question.prompt}>
          {options}
        </div>
      ) : (
        <RadioGroup
          aria-label={question.prompt}
          value={answer.selectedOptionIds[0] ?? ""}
          onValueChange={(value) => onChange({ ...answer, selectedOptionIds: [value] })}
        >
          {options}
        </RadioGroup>
      )}
      <label className="block space-y-2 text-xs font-medium text-muted-foreground">
        Your answer or notes
        <Textarea
          aria-label={`Notes: ${question.prompt}`}
          size="sm"
          value={answer.notes}
          disabled={disabled}
          placeholder="Add your own answer, constraints, or a reason…"
          onChange={(event) => onChange({ ...answer, notes: event.target.value })}
        />
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={answer.deferred}
          disabled={disabled}
          onCheckedChange={(deferred) => onChange({ ...answer, deferred })}
        />
        Defer this question
      </label>
    </article>
  );
}
