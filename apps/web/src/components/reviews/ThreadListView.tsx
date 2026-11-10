import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationReadScope,
  ThreadId,
  LIST_MAX_DEPTH,
  listItemNeedsHandoff,
  type ListItem,
  type ScopedThreadRef,
  type ThreadListEntry,
  type ThreadListUpdateInput,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  LoaderCircleIcon,
  PlusIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatElapsedDurationLabel } from "../../timestampFormat";
import { useNowMinute } from "../../hooks/useNowMinute";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../ui/menu";
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
import { Badge } from "../ui/badge";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

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
  const update = useAtomCommand(threadListUpdate, { reportFailure: false });
  const newItemRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<ThreadListEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [history, setHistory] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [parent, setParent] = useState<ListItem | null>(null);
  const [error, setError] = useState("");
  const remote = supplied ?? query.data?.[0];
  const entry = saved && (!remote || saved.revision > remote.revision) ? saved : remote;
  const mutate = async (change: Pick<ThreadListUpdateInput, "changes" | "order">) => {
    if (!entry || busy || !canWrite) return;
    setBusy(true);
    setError("");
    let ok = false;
    {
      const result = await update({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, expectedRevision: entry.revision, ...change },
      });
      if (result._tag === "Success") {
        ok = true;
        setSaved({
          ...entry,
          ...result.value,
          items: supplied ? result.value.items.filter((item) => item.needsQa) : result.value.items,
        });
        query.refresh();
        artifacts.refresh();
        onRefresh?.();
      } else {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : String(cause));
        query.refresh();
      }
    }
    setBusy(false);
    return ok;
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
  const children = (id: string): ListItem[] =>
    entry.items
      .filter((item) => item.parentId === id)
      .flatMap((item) => [item, ...children(item.id)]);
  const rows = (parentId: string | null, depth: number): { item: ListItem; depth: number }[] =>
    shown
      .filter((item) =>
        parentId === null
          ? !item.parentId || !shown.some((parent) => parent.id === item.parentId)
          : item.parentId === parentId,
      )
      .flatMap((item) => [
        { item, depth },
        ...(collapsed.has(item.id) || depth >= LIST_MAX_DEPTH - 1 ? [] : rows(item.id, depth + 1)),
      ]);
  const ordered = rows(null, 0);
  const move = (id: string, direction: number) => {
    const order = entry.items.map((item) => item.id);
    const from = order.indexOf(id),
      to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    void mutate({ changes: [], order });
  };
  return (
    <div className="@container mx-auto w-full max-w-4xl space-y-3 text-xs">
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
      <div className="space-y-1" aria-label="Thread list">
        {ordered.map(({ item, depth }) => (
          <div key={item.id} className={depth === 2 ? "ml-4" : depth === 1 ? "ml-2" : ""}>
            <ListRow
              item={item}
              progress={
                children(item.id).length
                  ? `${children(item.id).filter((child) => child.state === "done").length}/${children(item.id).length}`
                  : null
              }
              collapsed={collapsed.has(item.id)}
              onToggle={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
              onAddChild={depth < LIST_MAX_DEPTH - 1 ? () => setParent(item) : undefined}
              newItemRef={newItemRef}
              disabled={!canWrite || busy}
              onChange={(changes) => void mutate({ changes: [{ id: item.id, ...changes }] })}
              onMove={supplied ? undefined : (direction) => move(item.id, direction)}
              artifactCounts={
                new Map(
                  artifacts.data?.map((artifact) => [artifact.id, artifact.unansweredQuestions]),
                )
              }
              artifactTitles={
                new Map(artifacts.data?.map((artifact) => [artifact.id, artifact.title]))
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
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {!supplied ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim())
              void mutate({
                changes: [{ text: text.trim(), owner: "you", parentId: parent?.id ?? null }],
              }).then((ok) => {
                if (ok) {
                  setText("");
                  setParent(null);
                }
              });
          }}
        >
          {parent ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate">Under: {parent.text}</span>
              <Button size="xs" variant="ghost" onClick={() => setParent(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Input
              ref={newItemRef}
              aria-label="New list item"
              placeholder="Add an item…"
              value={text}
              disabled={!canWrite || busy}
              onChange={(event) => setText(event.target.value)}
            />
            <Button
              type="submit"
              size="icon"
              variant="outline"
              aria-label="Add list item"
              disabled={!canWrite || busy || !text.trim()}
            >
              <PlusIcon />
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ListRow({
  item,
  progress,
  collapsed,
  onToggle,
  onAddChild,
  newItemRef,
  disabled,
  onChange,
  onMove,
  artifactCounts,
  artifactTitles,
  threadRef,
}: {
  item: ListItem;
  progress: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onAddChild: (() => void) | undefined;
  newItemRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onChange: (change: ThreadListUpdateInput["changes"][number]) => void;
  onMove?: ((direction: number) => void) | undefined;
  artifactCounts: Map<string, number>;
  artifactTitles: Map<string, string>;
  threadRef: ScopedThreadRef;
}) {
  const focusNewItem = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const terminal = item.state === "done" || item.state === "dropped";
  const openLink = listItemNeedsHandoff(item);
  const links = item.links.map((link) => {
    const state = item.linkStates?.find(
      (live) => live.type === link.type && live.target === link.target,
    );
    const label =
      (link.type === "artifact" ? artifactTitles.get(link.target) : undefined) ??
      (link.type === "ticket" ? link.target : state?.title) ??
      link.target;
    const count = link.type === "artifact" ? artifactCounts.get(link.target) : undefined;
    const content = (
      <>
        {link.type === "thread" && state?.state === "open" ? (
          <LoaderCircleIcon className="size-3" aria-label="Lane running" />
        ) : null}
        <span className="min-w-0 truncate">
          {label}
          {state && link.type !== "artifact" ? ` · ${state.label}` : ""}
        </span>
        {count ? <span className="shrink-0">· {count}</span> : null}
      </>
    );
    const description = `${label}${state && link.type !== "artifact" ? ` · ${state.label}` : ""}${count ? ` · ${count} unanswered` : ""}`;
    const chip =
      link.type === "artifact" ? (
        <Badge
          variant="outline"
          size="sm"
          render={
            <button
              type="button"
              aria-label={`Open artifact: ${description}`}
              onClick={() => useRightPanelStore.getState().openReviews(threadRef, link.target)}
            />
          }
        >
          <span className="flex min-w-0 max-w-48 items-center gap-1">{content}</span>
        </Badge>
      ) : link.type === "thread" ? (
        <Badge
          variant="outline"
          size="sm"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={{
                environmentId: threadRef.environmentId,
                threadId: ThreadId.make(link.target),
              }}
            />
          }
        >
          <span className="flex min-w-0 max-w-48 items-center gap-1">{content}</span>
        </Badge>
      ) : (
        <Badge
          variant="outline"
          size="sm"
          render={<a href={state?.url ?? link.target} target="_blank" rel="noreferrer" />}
        >
          <span className="flex min-w-0 max-w-48 items-center gap-1">{content}</span>
        </Badge>
      );
    return (
      <Tooltip key={`${link.type}:${link.target}`}>
        <TooltipTrigger render={<span className="min-w-0 truncate" />}>{chip}</TooltipTrigger>
        <TooltipPopup>{description}</TooltipPopup>
      </Tooltip>
    );
  });
  return (
    <div className="rounded-lg border border-border/60 hover:bg-muted/30">
      <div className="flex min-h-10 min-w-0 items-center gap-1 px-2 py-1.5">
        {progress ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${item.text}`}
            onClick={onToggle}
          >
            <ChevronRightIcon className={collapsed ? "" : "rotate-90"} />
          </Button>
        ) : (
          <span className="size-7 shrink-0 sm:size-6" aria-hidden />
        )}
        <Checkbox
          aria-label={terminal ? `Reopen ${item.text}` : `Complete ${item.text}`}
          checked={terminal}
          disabled={disabled}
          onCheckedChange={() =>
            onChange({ state: terminal ? "open" : openLink ? "handed_off" : "done" })
          }
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="min-w-0 flex-1 text-left hover:underline"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              />
            }
          >
            <span className="line-clamp-2 break-words leading-5">{item.text}</span>
          </TooltipTrigger>
          <TooltipPopup>
            {item.text} · Assigned to {item.owner === "you" ? "you" : "the agent"}
          </TooltipPopup>
        </Tooltip>
        {progress ? (
          <Badge size="sm" variant="secondary">
            {progress}
          </Badge>
        ) : null}
        {item.state === "dropped" ? <span className="text-muted-foreground">dropped</span> : null}
        <ItemTimestamp item={item} />
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${item.text}`} />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup
            finalFocus={() => {
              if (!focusNewItem.current) return true;
              focusNewItem.current = false;
              newItemRef.current?.scrollIntoView({ block: "nearest" });
              return newItemRef.current;
            }}
          >
            <MenuItem
              disabled={disabled || !onAddChild}
              onClick={() => {
                focusNewItem.current = true;
                onAddChild?.();
              }}
            >
              Add sub-item
            </MenuItem>
            <MenuItem onClick={() => setExpanded(!expanded)}>
              {expanded ? "Hide details" : "Edit details"}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {links.length ? (
        <div className="hidden flex-wrap items-center gap-1 px-2 pb-2 @md:flex">{links}</div>
      ) : null}
      {expanded ? (
        <div className="space-y-2 border-t border-border/60 p-2">
          <div className="flex flex-wrap gap-2">{links}</div>
          <p className="text-muted-foreground">
            {item.doneAt ? "Completed" : "Added"}{" "}
            {new Date(item.doneAt ?? item.createdAt).toLocaleString()}
          </p>
          <Textarea
            size="sm"
            aria-label={`Text for ${item.text}`}
            value={text ?? item.text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value.replace(/[\r\n]+/g, " "))}
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

function ItemTimestamp({ item }: { item: ListItem }) {
  const nowMinute = useNowMinute();
  const timestamp = item.doneAt ?? item.createdAt;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            dateTime={timestamp}
            className="hidden shrink-0 text-3xs text-muted-foreground @min-[320px]:inline"
          />
        }
      >
        {formatElapsedDurationLabel(timestamp, Date.parse(`${nowMinute}:00.000Z`))}
      </TooltipTrigger>
      <TooltipPopup>{new Date(timestamp).toLocaleString()}</TooltipPopup>
    </Tooltip>
  );
}
