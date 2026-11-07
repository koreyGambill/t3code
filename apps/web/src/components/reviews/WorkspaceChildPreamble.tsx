import { useId, useState } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export function WorkspaceChildPreamble({
  value,
  disabled,
  onSave,
}: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onSave: (childPreamble: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const dirty = draft !== null && draft !== value;
  return (
    <section aria-labelledby={id} className="space-y-1.5 border-b border-border/50 p-3">
      <h3 id={id} className="text-xs font-medium">
        Child preamble
      </h3>
      <p className="text-2xs text-muted-foreground">
        Added before the task of every delegate this thread starts, marked as coming from this
        Workspace. The task wins where they differ.
      </p>
      <Textarea
        aria-labelledby={id}
        value={draft ?? value}
        disabled={disabled}
        placeholder="Setup facts every child needs, such as the checkout to use or checks to run."
        onChange={(event) => setDraft(event.target.value)}
      />
      {dirty ? (
        <div className="flex gap-1.5">
          <Button
            size="xs"
            disabled={disabled}
            onClick={() => {
              onSave(draft);
              setDraft(null);
            }}
          >
            Save
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
            Discard
          </Button>
        </div>
      ) : null}
    </section>
  );
}
