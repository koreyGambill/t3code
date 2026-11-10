import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationReadScope,
  ThreadId,
  listItemNeedsHandoff,
  type ListItem,
  type ScopedThreadRef,
  type ThreadListEntry,
  type ThreadListUpdateInput,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadArtifactList, threadListRead, threadListUpdate } from "../../state/threadWorkspace";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRightPanelStore } from "../../rightPanelStore";
import { useThreadContextSidebarStore } from "../../threadContextSidebarStore";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export function ThreadListView({
  threadRef,
  entry: supplied,
  onRefresh,
}: {
  threadRef: ScopedThreadRef;
  entry?: ThreadListEntry;
  onRefresh?: () => void;
}) {
  const readable = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    !supplied && readable
      ? threadListRead({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, all: true },
        })
      : null,
  );
  const artifacts = useEnvironmentQuery(
    readable
      ? threadArtifactList({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const canWrite = useAtomValue(threadListUpdate.permissionAtom(threadRef.environmentId));
  const update = useAtomCommand(threadListUpdate);
  const [saved, setSaved] = useState<ThreadListEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [history, setHistory] = useState(false);
  const remote = supplied ?? query.data?.[0];
  const entry = saved && (!remote || saved.revision > remote.revision) ? saved : remote;
  const mutate = async (change: Pick<ThreadListUpdateInput, "changes" | "order">) => {
    if (!entry || busy || !canWrite) return;
    setBusy(true);
    {
      const result = await update({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, expectedRevision: entry.revision, ...change },
      });
      if (result._tag === "Success") {
        setSaved({
          ...entry,
          ...result.value,
          items: supplied ? result.value.items.filter((item) => item.needsQa) : result.value.items,
        });
        query.refresh();
        artifacts.refresh();
        onRefresh?.();
      } else query.refresh();
    }
    setBusy(false);
  };
  if (!readable)
    return (
      <p className="p-3 text-xs text-muted-foreground">This connection cannot read the list.</p>
    );
  if (!entry)
    return <p className="p-3 text-xs text-muted-foreground">{query.error ?? "Loading list…"}</p>;
  const shown = entry.items.filter(
    (item) => supplied || history || item.state === "open" || item.state === "handed_off",
  );
  const ordered = shown
    .filter((item) => !item.parentId || !shown.some((parent) => parent.id === item.parentId))
    .flatMap((item) => [item, ...shown.filter((child) => child.parentId === item.id)]);
  const move = (id: string, direction: number) => {
    const order = entry.items.map((item) => item.id);
    const from = order.indexOf(id),
      to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    void mutate({ changes: [], order });
  };
  return (
    <div className="space-y-2 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span>
          {entry.items.filter((item) => item.state === "done").length}/{entry.items.length} done
        </span>
        {!supplied ? (
          <Button variant="ghost" size="xs" onClick={() => setHistory(!history)}>
            {history ? "Hide history" : "Show history"}
          </Button>
        ) : null}
      </div>
      <div className="max-h-96 space-y-1 overflow-y-auto" aria-label="Thread list">
        {ordered.map((item, index) => (
          <div key={item.id} className={item.parentId ? "ml-4" : ""}>
            {index === 0 ||
            new Date(
              ordered[index - 1]!.doneAt ?? ordered[index - 1]!.createdAt,
            ).toLocaleDateString() !==
              new Date(item.doneAt ?? item.createdAt).toLocaleDateString() ? (
              <p className="py-1 text-3xs text-muted-foreground">
                {new Date(item.doneAt ?? item.createdAt).toLocaleDateString()}
              </p>
            ) : null}
            <ListRow
              item={item}
              disabled={!canWrite || busy}
              onChange={(changes) => void mutate({ changes: [{ id: item.id, ...changes }] })}
              onMove={supplied ? undefined : (direction) => move(item.id, direction)}
              artifactCounts={
                new Map(
                  artifacts.data?.map((artifact) => [artifact.id, artifact.unansweredQuestions]),
                )
              }
              threadRef={threadRef}
            />
          </div>
        ))}
        {!ordered.length ? <p className="text-muted-foreground">No open items.</p> : null}
      </div>
      {entry.summaryNotes ? (
        <p className="whitespace-pre-wrap text-muted-foreground">{entry.summaryNotes}</p>
      ) : null}
      {!supplied ? (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim())
              void mutate({ changes: [{ text: text.trim(), owner: "you" }] }).then(() =>
                setText(""),
              );
          }}
        >
          <Input
            aria-label="New list item"
            value={text}
            disabled={!canWrite || busy}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" size="xs" disabled={!canWrite || busy || !text.trim()}>
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function ListRow({
  item,
  disabled,
  onChange,
  onMove,
  artifactCounts,
  threadRef,
}: {
  item: ListItem;
  disabled: boolean;
  onChange: (change: ThreadListUpdateInput["changes"][number]) => void;
  onMove?: ((direction: number) => void) | undefined;
  artifactCounts: Map<string, number>;
  threadRef: ScopedThreadRef;
}) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const terminal = item.state === "done" || item.state === "dropped";
  const openLink = listItemNeedsHandoff(item);
  return (
    <div className="rounded border border-border/60">
      <div className="flex min-w-0 items-center gap-1 p-1">
        <Checkbox
          aria-label={terminal ? `Reopen ${item.text}` : `Complete ${item.text}`}
          checked={terminal}
          disabled={disabled}
          onCheckedChange={() =>
            onChange({ state: terminal ? "open" : openLink ? "handed_off" : "done" })
          }
        />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {item.owner === "you" ? "You · " : ""}
          {item.text}
        </button>
        {item.state === "dropped" ? <span className="text-muted-foreground">dropped</span> : null}
        <div className="flex max-w-[45%] gap-1 overflow-x-auto">
          {item.links.map((link) => {
            const state = item.linkStates?.find(
              (live) => live.type === link.type && live.target === link.target,
            );
            const label = state?.label ?? link.target;
            const count = link.type === "artifact" ? artifactCounts.get(link.target) : undefined;
            const content = (
              <>
                {link.type === "thread" && state?.state === "open" ? (
                  <LoaderCircleIcon className="size-3" aria-label="Lane running" />
                ) : null}
                {label}
                {state?.state === "needs_review" ? " · needs review" : ""}
                {count ? ` · ${count} unanswered` : ""}
              </>
            );
            return link.type === "artifact" ? (
              <button
                key={`${link.type}:${link.target}`}
                className="flex shrink-0 items-center gap-1 rounded bg-muted px-1"
                onClick={() => {
                  useRightPanelStore.getState().openReviews(threadRef, link.target);
                  useRightPanelStore.getState().setWorkspaceSection(threadRef, "artifacts");
                }}
              >
                {content}
              </button>
            ) : link.type === "thread" ? (
              <Link
                key={`${link.type}:${link.target}`}
                to="/$environmentId/$threadId"
                params={{
                  environmentId: threadRef.environmentId,
                  threadId: ThreadId.make(link.target),
                }}
                className="flex shrink-0 items-center gap-1 rounded bg-muted px-1 hover:underline"
              >
                {content}
              </Link>
            ) : (
              <a
                key={`${link.type}:${link.target}`}
                className="flex shrink-0 items-center gap-1 rounded bg-muted px-1 hover:underline"
                href={state?.url ?? link.target}
                target="_blank"
                rel="noreferrer"
              >
                {content}
              </a>
            );
          })}
        </div>
      </div>
      {expanded ? (
        <div className="space-y-2 border-t border-border/60 p-2">
          <Input
            aria-label={`Text for ${item.text}`}
            value={text ?? item.text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
              if (text?.trim() && text.trim() !== item.text) onChange({ text: text.trim() });
              setText(null);
            }}
          />
          <Textarea
            aria-label={`Details for ${item.text}`}
            value={details ?? item.details}
            disabled={disabled}
            onChange={(event) => setDetails(event.target.value)}
            onBlur={() => {
              if (details !== null && details !== item.details) onChange({ details });
              setDetails(null);
            }}
          />
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange({ state: terminal ? "open" : "dropped" })}
            >
              {terminal ? "Reopen" : "Drop"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange({ owner: item.owner === "you" ? "agent" : "you" })}
            >
              {item.owner === "you" ? "Assign agent" : "Assign you"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange({ needsQa: !item.needsQa })}
            >
              {item.needsQa ? "Clear QA" : "Needs QA"}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Move ${item.text} up`}
              disabled={disabled || !onMove}
              onClick={() => onMove?.(-1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Move ${item.text} down`}
              disabled={disabled || !onMove}
              onClick={() => onMove?.(1)}
            >
              <ArrowDownIcon />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ThreadListSummary({ threadRef }: { threadRef: ScopedThreadRef }) {
  const readable = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    readable
      ? threadListRead({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, all: true },
        })
      : null,
  );
  const entry = query.data?.[0];
  if (!entry) return null;
  const next = entry.items.find((item) => item.state === "open")?.text ?? entry.summaryNotes;
  return (
    <button
      className="flex w-full min-w-0 gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
      onClick={() => useThreadContextSidebarStore.getState().openList(threadRef)}
    >
      <span className="shrink-0">
        List · {entry.items.filter((item) => item.state === "done").length}/{entry.items.length}
      </span>
      <span className="truncate text-muted-foreground">· next: {next}</span>
    </button>
  );
}

export function YourQaView({ threadRef }: { threadRef: ScopedThreadRef }) {
  const readable = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    readable
      ? threadListRead({
          environmentId: threadRef.environmentId,
          input: { allThreads: true, all: true, needsQa: true },
        })
      : null,
  );
  return (
    <div className="overflow-y-auto p-3">
      <h2 className="text-sm font-medium">Needs your QA</h2>
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.data
        ?.filter((entry) => entry.items.length > 0)
        .map((entry) => (
          <section key={entry.threadId} className="border-b border-border py-2">
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId: threadRef.environmentId, threadId: entry.threadId }}
              className="text-xs text-primary hover:underline"
            >
              {entry.threadTitle}
            </Link>
            <ThreadListView
              threadRef={{ ...threadRef, threadId: entry.threadId }}
              entry={entry}
              onRefresh={query.refresh}
            />
          </section>
        ))}
      {query.data?.every((entry) => entry.items.length === 0) ? (
        <p className="py-3 text-xs text-muted-foreground">Nothing needs your QA.</p>
      ) : null}
    </div>
  );
}
