import type { ReviewAnnotation } from "@t3tools/contracts";
import { MessageSquarePlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export interface ReviewQuote {
  readonly quote: string;
  readonly questionId: string | null;
}

export function ReviewNotes({
  sectionId,
  annotations,
  quote,
  disabled,
  onChange,
}: {
  readonly sectionId: string;
  readonly annotations: ReadonlyArray<ReviewAnnotation>;
  readonly quote: ReviewQuote | null;
  readonly disabled: boolean;
  readonly onChange: (annotations: ReadonlyArray<ReviewAnnotation>) => void;
}) {
  const [editing, setEditing] = useState<{
    id: string;
    quote: string | null;
    questionId: string | null;
  } | null>(null);
  const active = annotations.find((note) => note.id === editing?.id);
  return (
    <div className="space-y-3">
      {annotations
        .filter((note) => note.sectionId === sectionId && note.id !== editing?.id)
        .map((note) => (
          <div
            key={note.id}
            className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
          >
            {note.quote ? (
              <blockquote className="border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground">
                {note.quote}
              </blockquote>
            ) : null}
            <p className="whitespace-pre-wrap">{note.body}</p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="xs"
                disabled={disabled}
                onClick={() => setEditing(note)}
              >
                Edit note
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                aria-label="Delete note"
                onClick={() => onChange(annotations.filter((entry) => entry.id !== note.id))}
              >
                <Trash2Icon className="size-3" />
              </Button>
            </div>
          </div>
        ))}
      {editing ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          {editing.quote ? (
            <blockquote className="border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground">
              {editing.quote}
            </blockquote>
          ) : null}
          <Textarea
            autoFocus
            size="sm"
            aria-label="Annotation note"
            value={active?.body ?? ""}
            disabled={disabled}
            placeholder="Write a note about this part…"
            onChange={(event) => {
              const remaining = annotations.filter((note) => note.id !== editing.id);
              onChange(
                event.target.value.trim()
                  ? [...remaining, { ...editing, sectionId, body: event.target.value }]
                  : remaining,
              );
            }}
          />
          <Button variant="outline" size="xs" onClick={() => setEditing(null)}>
            Done
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() =>
            setEditing({
              id: randomUUID(),
              quote: quote?.quote ?? null,
              questionId: quote?.questionId ?? null,
            })
          }
        >
          <MessageSquarePlusIcon className="size-3.5" />{" "}
          {quote ? "Add note on selection" : "Add note"}
        </Button>
      )}
    </div>
  );
}
