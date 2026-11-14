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
  BotIcon,
  CheckCheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  NotebookTextIcon,
  PlusIcon,
  UserIcon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatElapsedDurationLabel } from "../../timestampFormat";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadArtifactList, threadListRead, threadListUpdate } from "../../state/threadWorkspace";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadContextSidebarStore } from "../../threadContextSidebarStore";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Empty, EmptyDescription, EmptyMedia } from "../ui/empty";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { todoIndentTarget, todoTree, type TodoFilter, type TodoNode } from "./todoList.logic";

type Owner = ListItem["owner"];
type Change = ThreadListUpdateInput["changes"][number];

const filterLabels: Record<TodoFilter, string> = { all: "All", mine: "Mine", agents: "Agents" };

const ownerLabel = (owner: Owner) =>
  owner === "agent" ? "Agent is responsible" : "You're responsible";

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
  const filter = useThreadContextSidebarStore((state) => state.todoFilter);
  const showClosed = useThreadContextSidebarStore((state) => state.todoShowClosed);
  const newItemRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<ThreadListEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<Owner>("you");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [parent, setParent] = useState<ListItem | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [error, setError] = useState("");
  const remote = supplied ?? query.data?.[0];
  const entry = saved && (!remote || saved.revision > remote.revision) ? saved : remote;
  const mutate = async (change: Pick<ThreadListUpdateInput, "changes" | "order">) => {
    if (!entry || busy || !canWrite) return;
    setBusy(true);
    setError("");
    let ok = false;
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
    setBusy(false);
    return ok;
  };
  if (!readable)
    return <p className="text-xs text-muted-foreground">This connection cannot read todos.</p>;
  if (!entry)
    return <p className="text-xs text-muted-foreground">{query.error ?? "Loading todos…"}</p>;
  const tree = supplied
    ? todoTree(entry.items, { filter: "all", showClosed: true })
    : todoTree(entry.items, { filter, showClosed });
  const done = entry.items.filter((item) => item.state === "done").length;
  const move = (id: string, direction: number) => {
    const order = entry.items.map((item) => item.id);
    const from = order.indexOf(id);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    void mutate({ changes: [], order });
  };
  const indent = (id: string, direction: "in" | "out") => {
    const parentId = todoIndentTarget(entry.items, id, direction);
    if (parentId === undefined) return false;
    void mutate({ changes: [{ id, parentId }] });
    return true;
  };
  const artifactCounts = new Map(
    artifacts.data?.map((artifact) => [artifact.id, artifact.unansweredQuestions]),
  );
  const artifactTitles = new Map(artifacts.data?.map((artifact) => [artifact.id, artifact.title]));
  const renderBranch = (node: TodoNode, depth: number) => (
    <div key={node.item.id} role="listitem">
      <TodoRow
        crossThread={Boolean(supplied)}
        node={node}
        collapsed={collapsed.has(node.item.id)}
        onToggle={() =>
          setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(node.item.id)) next.delete(node.item.id);
            else next.add(node.item.id);
            return next;
          })
        }
        onAddChild={depth < LIST_MAX_DEPTH - 1 ? () => setParent(node.item) : undefined}
        newItemRef={newItemRef}
        disabled={!canWrite || busy}
        onChange={(change) => void mutate({ changes: [{ id: node.item.id, ...change }] })}
        onMove={supplied ? undefined : (direction) => move(node.item.id, direction)}
        canIndent={!supplied && todoIndentTarget(entry.items, node.item.id, "in") !== undefined}
        canOutdent={!supplied && todoIndentTarget(entry.items, node.item.id, "out") !== undefined}
        onIndent={(direction) => indent(node.item.id, direction)}
        artifactCounts={artifactCounts}
        artifactTitles={artifactTitles}
        threadRef={threadRef}
      />
      {node.children.length && !collapsed.has(node.item.id) ? (
        <div role="list" className="ml-2 border-l border-border/60 pl-2">
          {node.children.map((child) => renderBranch(child, depth + 1))}
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="@container mx-auto w-full max-w-4xl space-y-2 text-xs">
      {!supplied ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="outline"
                  size="xs"
                  className="@min-[12rem]:hidden"
                  aria-label="Filter todos"
                />
              }
            >
              {filterLabels[filter]}
              {showClosed ? " · all states" : ""}
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup
                value={filter}
                onValueChange={(next) => {
                  if (next === "all" || next === "mine" || next === "agents")
                    useThreadContextSidebarStore.getState().setTodoFilter(next);
                }}
              >
                {(["all", "mine", "agents"] as const).map((value) => (
                  <MenuRadioItem key={value} value={value}>
                    {filterLabels[value]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuCheckboxItem
                checked={showClosed}
                onCheckedChange={(checked) =>
                  useThreadContextSidebarStore.getState().setTodoShowClosed(checked)
                }
              >
                Show done and dropped
              </MenuCheckboxItem>
            </MenuPopup>
          </Menu>
          <ToggleGroup
            className="hidden @min-[12rem]:flex"
            aria-label="Whose todos"
            value={[filter]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "all" || value === "mine" || value === "agents")
                useThreadContextSidebarStore.getState().setTodoFilter(value);
            }}
          >
            {(["all", "mine", "agents"] as const).map((value) => (
              <Toggle key={value} value={value}>
                {filterLabels[value]}
              </Toggle>
            ))}
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="xs"
                  variant="ghost"
                  className="hidden @min-[12rem]:inline-flex"
                  aria-label="Show done and dropped"
                  pressed={showClosed}
                  onPressedChange={(pressed) =>
                    useThreadContextSidebarStore.getState().setTodoShowClosed(pressed)
                  }
                />
              }
            >
              <CheckCheckIcon />
            </TooltipTrigger>
            <TooltipPopup>{showClosed ? "Hide" : "Show"} done and dropped</TooltipPopup>
          </Tooltip>
          {entry.items.length ? (
            <span
              className="ml-auto shrink-0 tabular-nums text-muted-foreground"
              aria-label={`${done} of ${entry.items.length} done`}
            >
              {done}/{entry.items.length}
              <span className="hidden @min-[22rem]:inline"> done</span>
            </span>
          ) : null}
        </div>
      ) : null}
      <div role="list" aria-label="Todos">
        {tree.map((node) => renderBranch(node, 0))}
      </div>
      {!tree.length ? (
        entry.items.length ? (
          <p className="px-1 py-2 text-muted-foreground">
            Nothing here. {filter === "all" ? "Show done and dropped to see the rest." : "Try All."}
          </p>
        ) : (
          <Empty size="compact">
            <EmptyMedia variant="icon">
              <ListChecksIcon />
            </EmptyMedia>
            <EmptyDescription>
              No todos yet. Add one below, or ask an agent to track its work here.
            </EmptyDescription>
          </Empty>
        )
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {!supplied ? (
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim())
              void mutate({
                changes: [{ text: text.trim(), owner, parentId: parent?.id ?? null }],
              }).then((ok) => {
                if (ok) {
                  setText("");
                  setParent(null);
                }
              });
          }}
        >
          {parent ? (
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">Under: {parent.text}</span>
              <Button size="xs" variant="ghost" onClick={() => setParent(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`New todo owner: ${owner === "you" ? "you" : "agent"}`}
                    disabled={!canWrite || busy}
                    onClick={() => setOwner(owner === "you" ? "agent" : "you")}
                  />
                }
              >
                {owner === "agent" ? <BotIcon /> : <UserIcon />}
              </TooltipTrigger>
              <TooltipPopup>
                {owner === "agent" ? "For the agent" : "For you"} · click to switch
              </TooltipPopup>
            </Tooltip>
            <Input
              ref={newItemRef}
              size="compact"
              aria-label="New todo"
              placeholder="Add a todo…"
              value={text}
              disabled={!canWrite || busy}
              onChange={(event) => setText(event.target.value)}
            />
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              aria-label="Add todo"
              disabled={!canWrite || busy || !text.trim()}
            >
              <PlusIcon />
            </Button>
          </div>
        </form>
      ) : null}
      {entry.summaryNotes ? (
        <section>
          <CollapsibleSectionHeader expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
            Notes
          </CollapsibleSectionHeader>
          {notesOpen ? (
            <p className="whitespace-pre-wrap px-2 pb-1 leading-5 text-muted-foreground">
              {entry.summaryNotes}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function TodoRow({
  crossThread,
  node,
  collapsed,
  onToggle,
  onAddChild,
  newItemRef,
  disabled,
  onChange,
  onMove,
  canIndent,
  canOutdent,
  onIndent,
  artifactCounts,
  artifactTitles,
  threadRef,
}: {
  crossThread: boolean;
  node: TodoNode;
  collapsed: boolean;
  onToggle: () => void;
  onAddChild: (() => void) | undefined;
  newItemRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onChange: (change: Omit<Change, "id">) => void;
  onMove?: ((direction: number) => void) | undefined;
  canIndent: boolean;
  canOutdent: boolean;
  onIndent: (direction: "in" | "out") => boolean;
  artifactCounts: Map<string, number>;
  artifactTitles: Map<string, string>;
  threadRef: ScopedThreadRef;
}) {
  const { item, progress } = node;
  const focusNewItem = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const terminal = item.state === "done" || item.state === "dropped";
  const openLink = listItemNeedsHandoff(item);
  const saveText = () => {
    if (text?.trim() && text.trim() !== item.text) onChange({ text: text.trim() });
    setText(null);
  };
  const onTextKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key !== "Tab") return;
    saveText();
    if (onIndent(event.shiftKey ? "out" : "in")) event.preventDefault();
  };
  return (
    <div className={cn("rounded-md hover:bg-muted/40", node.context && "opacity-60")}>
      <div className="flex min-w-0 items-start gap-1 py-1 pr-0.5">
        {progress ? (
          <Button
            variant="ghost"
            size="icon-tiny"
            className="mt-0.5"
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${item.text}`}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            <ChevronRightIcon className={collapsed ? "" : "rotate-90"} />
          </Button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <Checkbox
          className="mt-0.5"
          aria-label={terminal ? `Reopen ${item.text}` : `Complete ${item.text}`}
          checked={terminal}
          disabled={disabled}
          onCheckedChange={() =>
            onChange({ state: terminal ? "open" : openLink ? "handed_off" : "done" })
          }
        />
        <div className="min-w-0 flex-1 leading-5">
          <button
            type="button"
            className={cn(
              "text-left break-words hover:underline",
              terminal && "text-muted-foreground line-through",
            )}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {item.text}
          </button>
          {item.state === "dropped" ? (
            <span className="ml-1 text-3xs text-muted-foreground">dropped</span>
          ) : item.state === "handed_off" ? (
            <span className="ml-1 text-3xs text-muted-foreground">handed off</span>
          ) : null}
          {progress ? (
            <span className="ml-1 text-3xs tabular-nums text-muted-foreground">
              {progress.done}/{progress.total}
            </span>
          ) : null}
          {item.details && !expanded ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-tiny"
                    className="ml-0.5 align-middle"
                    aria-label={`Show note for ${item.text}`}
                    onClick={() => setExpanded(true)}
                  />
                }
              >
                <NotebookTextIcon />
              </TooltipTrigger>
              <TooltipPopup>Has a note</TooltipPopup>
            </Tooltip>
          ) : null}
          <OwnerIcon
            owner={item.owner}
            className="ml-1 inline-flex align-middle @min-[12rem]:hidden"
          />
          {item.links.map((link) => (
            <TodoLinkChip
              crossThread={crossThread}
              key={`${link.type}:${link.target}`}
              link={link}
              item={item}
              artifactCounts={artifactCounts}
              artifactTitles={artifactTitles}
              threadRef={threadRef}
            />
          ))}
        </div>
        <OwnerIcon owner={item.owner} className="mt-0.5 hidden @min-[12rem]:flex" />
        <ItemTimestamp item={item} />
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon-tiny" aria-label={`Actions for ${item.text}`} />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup
            align="end"
            finalFocus={() => {
              if (!focusNewItem.current) return true;
              focusNewItem.current = false;
              newItemRef.current?.scrollIntoView({ block: "nearest" });
              return newItemRef.current;
            }}
          >
            <MenuItem onClick={() => setExpanded(true)}>
              {item.details ? "Edit note" : "Add note"}
            </MenuItem>
            <MenuItem
              disabled={disabled || !onAddChild}
              onClick={() => {
                focusNewItem.current = true;
                onAddChild?.();
              }}
            >
              Add sub-item
            </MenuItem>
            <MenuItem disabled={disabled || !canIndent} onClick={() => onIndent("in")}>
              Indent
            </MenuItem>
            <MenuItem disabled={disabled || !canOutdent} onClick={() => onIndent("out")}>
              Outdent
            </MenuItem>
            <MenuItem disabled={disabled || !onMove} onClick={() => onMove?.(-1)}>
              Move up
            </MenuItem>
            <MenuItem disabled={disabled || !onMove} onClick={() => onMove?.(1)}>
              Move down
            </MenuItem>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Responsible</MenuGroupLabel>
              <MenuRadioGroup
                value={item.owner}
                onValueChange={(next) => {
                  if ((next === "you" || next === "agent") && next !== item.owner)
                    onChange({ owner: next });
                }}
              >
                <MenuRadioItem value="you" disabled={disabled}>
                  You
                </MenuRadioItem>
                <MenuRadioItem value="agent" disabled={disabled}>
                  Agent
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuCheckboxItem
              checked={item.needsQa}
              disabled={disabled}
              onCheckedChange={(needsQa) => onChange({ needsQa })}
            >
              Needs QA
            </MenuCheckboxItem>
            <MenuItem
              disabled={disabled}
              onClick={() => onChange({ state: terminal ? "open" : "dropped" })}
            >
              {terminal ? "Reopen" : "Drop"}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {expanded ? (
        <div className="space-y-1.5 pb-2 pl-10 pr-1">
          <Input
            size="compact"
            aria-label={`Text for ${item.text}`}
            value={text ?? item.text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value.replace(/[\r\n]+/g, " "))}
            onKeyDown={onTextKeyDown}
            onBlur={saveText}
          />
          <Textarea
            size="compact"
            aria-label={`Note for ${item.text}`}
            placeholder="Add a note…"
            value={details ?? item.details}
            disabled={disabled}
            onChange={(event) => setDetails(event.target.value)}
            onBlur={() => {
              if (details !== null && details !== item.details) onChange({ details });
              setDetails(null);
            }}
          />
          <p className="text-3xs text-muted-foreground">
            {item.doneAt ? "Completed" : "Added"}{" "}
            {new Date(item.doneAt ?? item.createdAt).toLocaleString()} · Tab indents, Shift+Tab
            outdents
          </p>
        </div>
      ) : null}
    </div>
  );
}

function OwnerIcon({ owner, className }: { owner: Owner; className: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5",
              className,
            )}
            aria-label={ownerLabel(owner)}
            role="img"
          />
        }
      >
        {owner === "agent" ? <BotIcon /> : <UserIcon />}
      </TooltipTrigger>
      <TooltipPopup>{ownerLabel(owner)}</TooltipPopup>
    </Tooltip>
  );
}

function TodoLinkChip({
  crossThread,
  link,
  item,
  artifactCounts,
  artifactTitles,
  threadRef,
}: {
  crossThread: boolean;
  link: ListItem["links"][number];
  item: ListItem;
  artifactCounts: Map<string, number>;
  artifactTitles: Map<string, string>;
  threadRef: ScopedThreadRef;
}) {
  const state = item.linkStates?.find(
    (live) => live.type === link.type && live.target === link.target,
  );
  const label =
    (link.type === "artifact" ? artifactTitles.get(link.target) : undefined) ??
    (link.type === "ticket" ? link.target : state?.title) ??
    link.target;
  const count = link.type === "artifact" ? artifactCounts.get(link.target) : undefined;
  const status = state && link.type !== "artifact" ? state.label : null;
  const description = `${label}${status ? ` · ${status}` : ""}${count ? ` · ${count} unanswered` : ""}`;
  const content = (
    <span className="flex min-w-0 max-w-32 items-center gap-1">
      {link.type === "thread" && state?.state === "open" ? (
        <LoaderCircleIcon className="size-3" aria-label="Lane running" />
      ) : null}
      <span className="min-w-0 truncate">
        {label}
        {status ? ` · ${status}` : ""}
      </span>
      {count ? <span className="shrink-0">· {count}</span> : null}
    </span>
  );
  const chip =
    link.type === "artifact" ? (
      <Badge
        variant="outline"
        size="sm"
        render={
          <button
            type="button"
            aria-label={`Open artifact: ${description}`}
            onClick={() =>
              useThreadContextSidebarStore.getState().show("artifacts", {
                artifactId: link.target,
                // The QA view lists other threads, so their artifacts pin the sidebar to them.
                ...(crossThread ? { thread: threadRef } : {}),
              })
            }
          />
        }
      >
        {content}
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
        {content}
      </Badge>
    ) : (
      <Badge
        variant="outline"
        size="sm"
        render={<a href={state?.url ?? link.target} target="_blank" rel="noreferrer" />}
      >
        {content}
      </Badge>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="ml-1 inline-flex align-middle" />}>
        {chip}
      </TooltipTrigger>
      <TooltipPopup>{description}</TooltipPopup>
    </Tooltip>
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
  if (!entry?.items.length) return null;
  const next = entry.items.find((item) => item.state === "open")?.text ?? entry.summaryNotes;
  return (
    <button
      className="flex w-full min-w-0 gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
      onClick={() => useThreadContextSidebarStore.getState().show("todos", { thread: threadRef })}
    >
      <span className="shrink-0">
        Todos · {entry.items.filter((item) => item.state === "done").length}/{entry.items.length}
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
