import {
  isIndependentVerification,
  type AgentWorkItem,
  type ThreadWorkspace,
  type WorkVerification,
  type WorkspaceContextItem,
  type WorkspaceDecision,
  type WorkspaceMutation,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

type Apply = (changes: WorkspaceMutation[]) => void;
const workOrder = {
  active: 0,
  blocked: 1,
  queued: 2,
  done: 3,
  landed: 3,
} as const;
const workVariant = {
  active: "info",
  blocked: "warning",
  queued: "outline",
  done: "success",
  landed: "success",
} as const;
const qaVariant = {
  none: "outline",
  pending: "warning",
  passed: "success",
  issues: "error",
} as const;
const actorLabel = { user: "You", agent: "Agent" } as const;
const finished = (item: AgentWorkItem) => item.status === "done" || item.status === "landed";

function Row({ children }: { readonly children: React.ReactNode }) {
  return <li className="space-y-0.5 border-b border-border/50 px-2 py-1.5 text-xs">{children}</li>;
}
function Meta({ parts }: { readonly parts: ReadonlyArray<string> }) {
  const text = parts.filter(Boolean).join(" · ");
  return text ? <p className="text-2xs text-muted-foreground">{text}</p> : null;
}

function evidenceLabel(work: AgentWorkItem, verification: WorkVerification) {
  const kind = isIndependentVerification(work, verification)
    ? "independent run"
    : verification.method === "executed"
      ? "self-reported run"
      : "source review";
  return [
    `${verification.result} · ${kind}`,
    verification.verifier,
    verification.testedRevision && `at ${verification.testedRevision}`,
    verification.at.slice(0, 16).replace("T", " "),
    verification.details,
    verification.evidence && `Evidence: ${verification.evidence}`,
    verification.gaps && `Gaps: ${verification.gaps}`,
  ];
}

export function WorkRow({
  item,
  verifications,
  apply,
  disabled,
}: {
  readonly item: AgentWorkItem;
  readonly verifications: ReadonlyArray<WorkVerification>;
  readonly apply: Apply;
  readonly disabled: boolean;
}) {
  const [qaNote, setQaNote] = useState(item.userQaNote);
  const setQa = (userQa: AgentWorkItem["userQa"]) => apply([{ kind: "work", id: item.id, userQa }]);
  return (
    <Row>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Badge size="sm" variant={workVariant[item.status]}>
          {item.status}
        </Badge>
        {item.userQa !== "none" ? (
          <Badge size="sm" variant={qaVariant[item.userQa]}>
            QA {item.userQa}
          </Badge>
        ) : null}
        <span className="text-3xs text-muted-foreground">{item.ref}</span>
        <span className={finished(item) ? "text-muted-foreground" : ""}>{item.title}</span>
        {item.userQa !== "none" ? (
          <span className="ml-auto flex shrink-0 gap-1">
            {item.userQa === "pending" ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setQa("passed")}
                >
                  Pass
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => setQa("issues")}
                >
                  Issues
                </Button>
              </>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() => setQa("pending")}
              >
                Back to pending
              </Button>
            )}
          </span>
        ) : null}
      </div>
      <Meta
        parts={[
          item.remaining && !finished(item) ? `Left: ${item.remaining}` : "",
          item.changed && `Changed: ${item.changed}`,
          item.source ? `From ${item.source}` : "",
        ]}
      />
      <Meta parts={[item.qaSteps && `QA: ${item.qaSteps}`]} />
      <Meta parts={[item.checks && `Agent checks: ${item.checks}`]} />
      {item.userQa !== "none" ? (
        <form
          className="flex items-center gap-1 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            apply([{ kind: "work", id: item.id, userQaNote: qaNote }]);
          }}
        >
          <Input
            size="compact"
            aria-label={`QA note for ${item.title}`}
            placeholder="QA issues or notes…"
            value={qaNote}
            disabled={disabled}
            onChange={(event) => setQaNote(event.target.value)}
          />
          <Button
            size="xs"
            variant="outline"
            type="submit"
            disabled={disabled || qaNote === item.userQaNote}
          >
            Save note
          </Button>
        </form>
      ) : null}
      {verifications.map((verification) => (
        <Meta key={verification.id} parts={evidenceLabel(item, verification)} />
      ))}
    </Row>
  );
}

export function AgentWorkList({
  workspace,
  apply,
  disabled,
}: {
  readonly workspace: ThreadWorkspace;
  readonly apply: Apply;
  readonly disabled: boolean;
}) {
  const [qaFilter, setQaFilter] = useState("all");
  const items = workspace.agentWork.filter(
    (item) => qaFilter === "all" || item.userQa === qaFilter,
  );
  const sorted = items.toSorted(
    (left, right) =>
      workOrder[left.status] - workOrder[right.status] ||
      (right.completedAt ?? "").localeCompare(left.completedAt ?? ""),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1 text-2xs text-muted-foreground">
        Human QA
        <select
          aria-label="Human QA filter"
          value={qaFilter}
          onChange={(event) => setQaFilter(event.target.value)}
          className="rounded border border-input bg-background px-1"
        >
          <option value="all">All work</option>
          <option value="pending">Pending</option>
          <option value="passed">Passed</option>
          <option value="issues">Issues</option>
        </select>
      </label>
      {sorted.length ? (
        <ul aria-label="Agent work" className="min-h-0 flex-1 overflow-y-auto">
          {sorted.map((item) => (
            <WorkRow
              key={`${item.id}:${item.userQaNote}`}
              item={item}
              verifications={workspace.verifications.filter((entry) => entry.workId === item.id)}
              apply={apply}
              disabled={disabled}
            />
          ))}
        </ul>
      ) : (
        <p className="p-3 text-sm text-muted-foreground">
          {qaFilter !== "all"
            ? "No work matches this QA status."
            : "Work the agent takes on for this thread appears here and stays after it finishes."}
        </p>
      )}
    </div>
  );
}

function DecisionRow({
  decision,
  apply,
  disabled,
}: {
  readonly decision: WorkspaceDecision;
  readonly apply: Apply;
  readonly disabled: boolean;
}) {
  const set = (status: WorkspaceDecision["status"]) =>
    apply([{ kind: "decision", id: decision.id, status }]);
  return (
    <Row>
      <div className="flex items-baseline gap-2">
        <Badge size="sm" variant={decision.decidedBy === "user" ? "secondary" : "outline"}>
          {actorLabel[decision.decidedBy]}
        </Badge>
        <span className="text-3xs text-muted-foreground">{decision.ref}</span>
        <span className={decision.status === "superseded" ? "line-through" : ""}>
          {decision.title}
        </span>
        <span className="ml-auto flex shrink-0 gap-1">
          {decision.status === "proposed" ? (
            <Button size="xs" variant="outline" disabled={disabled} onClick={() => set("accepted")}>
              Accept
            </Button>
          ) : null}
          {decision.status === "accepted" && decision.decidedBy === "agent" ? (
            <Button size="xs" variant="ghost" disabled={disabled} onClick={() => set("proposed")}>
              Unaccept
            </Button>
          ) : null}
          {decision.status === "superseded" ? (
            <Button size="xs" variant="ghost" disabled={disabled} onClick={() => set("accepted")}>
              Restore
            </Button>
          ) : (
            <Button size="xs" variant="ghost" disabled={disabled} onClick={() => set("superseded")}>
              Supersede
            </Button>
          )}
        </span>
      </div>
      <Meta
        parts={[
          decision.status === "proposed" ? "Needs your OK" : "",
          decision.rationale,
          decision.source ? `From ${decision.source}` : "",
        ]}
      />
    </Row>
  );
}

function ContextRow({
  item,
  apply,
  disabled,
}: {
  readonly item: WorkspaceContextItem;
  readonly apply: Apply;
  readonly disabled: boolean;
}) {
  return (
    <Row>
      <div className="flex items-baseline gap-2">
        <Badge size="sm" variant="outline">
          {item.category}
        </Badge>
        <span>{item.title}</span>
        <Button
          size="icon-micro"
          variant="ghost"
          aria-label={`Remove ${item.title}`}
          className="ml-auto"
          disabled={disabled}
          onClick={() => apply([{ kind: "context", id: item.id, remove: true }])}
        >
          <XIcon />
        </Button>
      </div>
      <Meta
        parts={[
          item.details,
          `Added by ${actorLabel[item.recordedBy].toLowerCase()}`,
          item.source ? `from ${item.source}` : "",
        ]}
      />
    </Row>
  );
}

export function WorkspaceRecordList({
  workspace,
  apply,
  disabled,
}: {
  readonly workspace: ThreadWorkspace;
  readonly apply: Apply;
  readonly disabled: boolean;
}) {
  const [category, setCategory] = useState<WorkspaceContextItem["category"]>("preference");
  const [title, setTitle] = useState("");
  const decisions = workspace.decisions.toSorted(
    (left, right) => Number(left.status === "superseded") - Number(right.status === "superseded"),
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <h4 className="px-2 pt-2 text-xs font-medium text-muted-foreground">Decisions</h4>
      {decisions.length ? (
        <ul aria-label="Decisions">
          {decisions.map((decision) => (
            <DecisionRow key={decision.id} decision={decision} apply={apply} disabled={disabled} />
          ))}
        </ul>
      ) : (
        <p className="px-2 py-1 text-xs text-muted-foreground">No decisions recorded.</p>
      )}
      <h4 className="px-2 pt-3 text-xs font-medium text-muted-foreground">Context</h4>
      <ul aria-label="Context">
        {workspace.contextItems.map((item) => (
          <ContextRow key={item.id} item={item} apply={apply} disabled={disabled} />
        ))}
      </ul>
      <form
        className="flex items-center gap-1 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          apply([{ kind: "context", category, title: title.trim() }]);
          setTitle("");
        }}
      >
        <select
          aria-label="Context type"
          className="h-7 rounded border border-input bg-background px-1 text-xs"
          value={category}
          onChange={(event) => setCategory(event.target.value as WorkspaceContextItem["category"])}
        >
          <option value="preference">Preference</option>
          <option value="constraint">Constraint</option>
          <option value="context">Context</option>
        </select>
        <Input
          size="compact"
          aria-label="New context"
          placeholder="Add a preference, constraint, or fact…"
          value={title}
          disabled={disabled}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button size="xs" variant="outline" type="submit" disabled={disabled || !title.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}
