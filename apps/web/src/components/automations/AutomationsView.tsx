import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AutomationThreadContext } from "@t3tools/client-runtime/automations";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  ProjectId,
  type ScheduledTask,
  type ScheduledTaskRun,
  ScheduledTaskRunId,
  scheduledTaskThreadMode,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import {
  ArrowLeftIcon,
  BanIcon,
  CheckIcon,
  CircleDotIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SkipForwardIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { requestWorkspaceFocus } from "../../lib/workspaceFocus";
import { useEnvironment, useConnectedEnvironmentIds } from "../../state/environments";
import { useProject, useQuietThreadShells, useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  type AutomationSelection,
  useThreadContextSidebarStore,
} from "../../threadContextSidebarStore";
import { ScheduledRelativeLabel } from "../settings/ScheduledTasksSettings";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { SectionHeading, ToolFilterInput } from "../ThreadToolViews";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription } from "../ui/empty";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type AutomationRowModel,
  type AutomationScope,
  automationHomeThread,
  automationSections,
  compactScheduleLabel,
  runCostLabel,
  runOutcomeLabel,
  THREAD_MODE_LABELS,
} from "./automationsView.logic";

const rowKey = (environmentId: string, taskId: string) => `${environmentId}\n${taskId}`;

/** The open thread's project and ancestors, as the server's event filters see them. */
function useThreadContext(threadRef: ScopedThreadRef | null): AutomationThreadContext | null {
  const shell = useThreadShell(threadRef);
  const shells = useQuietThreadShells();
  if (threadRef === null || shell === null) return null;
  const lineage: string[] = [shell.id];
  let parent = shell.lineage.parentThreadId ?? shell.delegatedFrom?.threadId ?? null;
  while (parent !== null && lineage.length < 32 && !lineage.includes(parent)) {
    lineage.push(parent);
    const next = shells.find(
      (entry) => entry.environmentId === threadRef.environmentId && entry.id === parent,
    );
    parent = next?.lineage.parentThreadId ?? next?.delegatedFrom?.threadId ?? null;
  }
  return { threadId: shell.id, projectId: shell.projectId, lineage };
}

function reportFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : String(error),
    }),
  );
}

function useAutomationActions(environmentId: EnvironmentId) {
  const [busy, setBusy] = useState(false);
  const canOperate = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "automation toggle",
  });
  const setThreadEnabled = useAtomCommand(serverEnvironment.setScheduledTaskThreadEnabled, {
    label: "automation thread toggle",
  });
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "automation run now",
  });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    label: "automation delete",
  });
  const act = async (
    title: string,
    command: () => Promise<AtomCommandResult<unknown, unknown>>,
  ): Promise<boolean> => {
    if (busy || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return false;
    setBusy(true);
    const result = await command();
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(title, squashAtomCommandFailure(result));
    }
    return result._tag === "Success";
  };
  return {
    busy,
    canOperate,
    setEnabled: (task: ScheduledTask, enabled: boolean) =>
      act("Could not update automation", () =>
        setEnabled({ environmentId, input: { id: task.id, enabled } }),
      ),
    setThreadEnabled: (task: ScheduledTask, threadId: ThreadId, enabled: boolean) =>
      act("Could not update automation", () =>
        setThreadEnabled({ environmentId, input: { id: task.id, threadId, enabled } }),
      ),
    runNow: (task: ScheduledTask) =>
      act("Could not run automation", () => runNow({ environmentId, input: { id: task.id } })),
    remove: (task: ScheduledTask) =>
      act("Could not delete automation", () => remove({ environmentId, input: { id: task.id } })),
  };
}

function useOpenThread() {
  const navigate = useNavigate();
  return async (environmentId: EnvironmentId, threadId: string, focusComposer = false) => {
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, ThreadId.make(threadId))),
    });
    if (focusComposer) requestWorkspaceFocus({ area: "composer" });
  };
}

export function AutomationsView({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  const thread = useThreadContext(threadRef);
  const storedScope = useThreadContextSidebarStore((state) => state.automationScope);
  const selection = useThreadContextSidebarStore((state) => state.automationSelection);
  const [filter, setFilter] = useState("");
  const [showPaused, setShowPaused] = useState(true);
  const connected = useConnectedEnvironmentIds();
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const scope: AutomationScope =
    storedScope === null || (storedScope !== "server" && thread === null)
      ? thread === null
        ? "server"
        : "thread"
      : storedScope;
  const environmentIds =
    scope === "server" || threadRef === null ? connected : [threadRef.environmentId];
  const newEnvironmentId = threadRef?.environmentId ?? connected[0];

  const back = (from: AutomationSelection) => {
    useThreadContextSidebarStore.getState().selectAutomation(null);
    // Focus the row that opened the detail once the list has rendered again.
    requestAnimationFrame(() => {
      const row = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>("[data-automation-row]") ?? [],
      ).find(
        (element) => element.dataset.automationRow === rowKey(from.environmentId, from.taskId),
      );
      row?.focus();
    });
  };

  const listControls = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New automation"
              disabled={newEnvironmentId === undefined}
              onClick={() =>
                void navigate({
                  to: "/settings/scheduled-tasks",
                  search: {
                    ...(newEnvironmentId ? { environmentId: newEnvironmentId } : {}),
                    new: true,
                  },
                })
              }
            />
          }
        >
          <PlusIcon />
        </TooltipTrigger>
        <TooltipPopup>New automation</TooltipPopup>
      </Tooltip>
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Automation options" />}
              />
            }
          >
            <MoreHorizontalIcon />
          </TooltipTrigger>
          <TooltipPopup>Automation options</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end">
          <MenuCheckboxItem checked={showPaused} onCheckedChange={setShowPaused}>
            Show paused
          </MenuCheckboxItem>
          <MenuItem
            onClick={() =>
              void navigate({
                to: "/settings/scheduled-tasks",
                search: newEnvironmentId ? { environmentId: newEnvironmentId } : {},
              })
            }
          >
            Open settings
          </MenuItem>
        </MenuPopup>
      </Menu>
    </>
  );

  if (selection !== null) {
    return (
      <AutomationDetail
        environmentId={selection.environmentId as EnvironmentId}
        taskId={selection.taskId}
        thread={thread}
        onBack={() => back(selection)}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 px-2.5 pt-2.5 pb-2">
        <ToggleGroup
          aria-label="Automation scope"
          size="segmented-compact"
          className="w-full *:flex-1"
          value={[scope]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "thread" || next === "project" || next === "server") {
              useThreadContextSidebarStore.getState().setAutomationScope(next);
            }
          }}
        >
          <Toggle value="thread" disabled={thread === null}>
            Thread
          </Toggle>
          <Toggle value="project" disabled={thread === null}>
            Project
          </Toggle>
          <Toggle value="server">Server</Toggle>
        </ToggleGroup>
        <ToolFilterInput label="Filter automations" value={filter} onChange={setFilter}>
          {listControls}
        </ToolFilterInput>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2.5 pb-2.5 text-xs">
        {environmentIds.map((environmentId) => (
          <EnvironmentAutomations
            key={environmentId}
            environmentId={environmentId}
            grouped={environmentIds.length > 1}
            scope={scope}
            thread={thread}
            filter={filter}
            showPaused={showPaused}
          />
        ))}
      </div>
    </div>
  );
}

function EnvironmentAutomations(props: {
  environmentId: EnvironmentId;
  grouped: boolean;
  scope: AutomationScope;
  thread: AutomationThreadContext | null;
  filter: string;
  showPaused: boolean;
}) {
  const environment = useEnvironment(props.environmentId);
  const query = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const navigate = useNavigate();
  const sections = automationSections(query.data?.tasks ?? [], props);
  const rowProps = { environmentId: props.environmentId, timeZone: query.data?.timeZone };
  const empty = sections.on.length === 0 && sections.off.length === 0;
  const unfiltered = props.filter.trim() === "" && props.showPaused;
  return (
    <section className="space-y-1" aria-label={props.grouped ? environment?.label : undefined}>
      {props.grouped ? (
        <SectionHeading>{environment?.label ?? "Environment"}</SectionHeading>
      ) : null}
      {query.error !== null ? (
        <p className="text-destructive">Could not load automations: {query.error}</p>
      ) : query.data === null ? (
        <p className="text-muted-foreground">Loading automations…</p>
      ) : empty && !unfiltered ? (
        <p className="text-muted-foreground">No automations match.</p>
      ) : empty ? (
        <Empty size="compact">
          <EmptyDescription>
            {props.scope === "thread"
              ? "No automations apply to this thread."
              : props.scope === "project"
                ? "No automations run in this project."
                : "Automations run agents on a schedule, a webhook or an event."}
          </EmptyDescription>
          <EmptyContent>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                void navigate({
                  to: "/settings/scheduled-tasks",
                  search: { environmentId: props.environmentId, new: true },
                })
              }
            >
              <PlusIcon />
              New automation
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {props.scope === "thread" && sections.on.length > 0 ? (
            <SectionHeading>For this thread</SectionHeading>
          ) : null}
          {sections.on.map((row) => (
            <AutomationRow key={row.task.id} row={row} thread={props.thread} {...rowProps} />
          ))}
          {sections.off.length > 0 ? (
            <div className="space-y-1 pt-3">
              <SectionHeading>Off for this thread</SectionHeading>
              {sections.off.map((row) => (
                <AutomationRow
                  key={row.task.id}
                  row={row}
                  thread={props.thread}
                  offHere
                  {...rowProps}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

const LAST_RUN_LABELS: Record<ScheduledTask["lastRunStatus"], string> = {
  never: "Not run yet",
  running: "Running",
  succeeded: "Ran",
  failed: "Failed",
  skipped: "Skipped",
};

function AutomationRow({
  row,
  environmentId,
  timeZone,
  thread,
  offHere = false,
}: {
  row: AutomationRowModel;
  environmentId: EnvironmentId;
  timeZone: string | undefined;
  thread: AutomationThreadContext | null;
  offHere?: boolean;
}) {
  const { task, applies } = row;
  const actions = useAutomationActions(environmentId);
  const perThread = applies === "event" && thread !== null;
  const checked = perThread ? !offHere : task.enabled;
  const offCount = task.disabledThreadIds?.length ?? 0;
  const lit = task.enabled && !offHere;
  // Rows are narrow; the vendor prefix costs the trigger its room. Detail shows the full name.
  const model = formatModelSlugName(task.modelSelection.model).replace(/^Claude /, "");
  const trigger =
    compactScheduleLabel(task.schedule) ?? scheduleLabel(task.schedule, timeZone, task.nextRunAt);
  return (
    <div className="group/row relative min-w-0 rounded-md hover:bg-muted/40 focus-within:bg-muted/40">
      <button
        type="button"
        data-automation-row={rowKey(environmentId, task.id)}
        className="flex w-full min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-left outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset"
        onClick={() =>
          useThreadContextSidebarStore
            .getState()
            .selectAutomation({ environmentId, taskId: task.id })
        }
      >
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            task.lastRunStatus === "running"
              ? "bg-info"
              : lit
                ? "bg-success"
                : "ring-1 ring-muted-foreground ring-inset",
          )}
        />
        <span className="min-w-0 flex-1">
          <Tooltip>
            <TooltipTrigger
              render={<span className="block truncate pr-9 font-medium text-foreground" />}
            >
              {task.title}
            </TooltipTrigger>
            <TooltipPopup side="right">{task.title}</TooltipPopup>
          </Tooltip>
          <span className="flex min-w-0 text-muted-foreground">
            <span className="min-w-0 truncate">{trigger}</span>
            <span className="shrink-0 whitespace-pre"> · </span>
            <span className="max-w-[40%] shrink-0 truncate">{model}</span>
          </span>
          <span
            className={cn(
              "block truncate",
              task.lastRunStatus === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {offHere ? "off here · " : task.enabled ? "" : "paused · "}
            {LAST_RUN_LABELS[task.lastRunStatus]}
            {task.lastRunAt !== null && task.lastRunStatus !== "running" ? (
              <>
                {" "}
                <ScheduledRelativeLabel value={task.lastRunAt} />
              </>
            ) : null}
            {!perThread && offCount > 0
              ? ` · off for ${offCount} thread${offCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </span>
      </button>
      <span className="absolute top-1.5 right-1.5 flex">
        <Switch
          size="sm"
          checked={checked}
          disabled={!actions.canOperate || actions.busy}
          aria-label={
            perThread
              ? `${checked ? "Turn off" : "Turn on"} ${task.title} for this thread`
              : `${checked ? "Pause" : "Resume"} ${task.title}`
          }
          onCheckedChange={(next) =>
            void (perThread && thread
              ? actions.setThreadEnabled(task, ThreadId.make(thread.threadId), next)
              : actions.setEnabled(task, next))
          }
        />
      </span>
    </div>
  );
}

function AutomationDetail({
  environmentId,
  taskId,
  thread,
  onBack,
}: {
  environmentId: EnvironmentId;
  taskId: string;
  thread: AutomationThreadContext | null;
  onBack: () => void;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const task = query.data?.tasks.find((entry) => entry.id === taskId) ?? null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Menus render in a portal; their Escape closes the menu, not the detail.
    if (event.key !== "Escape" || !event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    onBack();
  };
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-2.5 text-xs"
      onKeyDown={onKeyDown}
    >
      {task === null ? (
        <div className="space-y-2">
          <Button size="xs" variant="ghost" autoFocus onClick={onBack}>
            <ArrowLeftIcon />
            Automations
          </Button>
          <p className="text-muted-foreground">
            {query.data === null && query.error === null
              ? "Loading automation…"
              : (query.error ?? "This automation no longer exists.")}
          </p>
        </div>
      ) : (
        <AutomationDetailBody
          environmentId={environmentId}
          task={task}
          timeZone={query.data?.timeZone}
          thread={thread}
          onBack={onBack}
        />
      )}
    </div>
  );
}

function AutomationDetailBody({
  environmentId,
  task,
  timeZone,
  thread,
  onBack,
}: {
  environmentId: EnvironmentId;
  task: ScheduledTask;
  timeZone: string | undefined;
  thread: AutomationThreadContext | null;
  onBack: () => void;
}) {
  const actions = useAutomationActions(environmentId);
  const navigate = useNavigate();
  const openThread = useOpenThread();
  const project = useProject(scopeProjectRef(environmentId, ProjectId.make(task.projectId)));
  const boundShell = useThreadShell(
    task.threadId === null ? null : scopeThreadRef(environmentId, task.threadId),
  );
  const runs = useEnvironmentQuery(
    serverEnvironment.scheduledTaskRuns({ environmentId, input: { id: task.id } }),
  );
  const refreshKey = `${task.lastRunAt ?? ""}|${task.lastRunEndedAt ?? ""}`;
  const seenKey = useRef(refreshKey);
  const { refresh } = runs;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A run that starts or ends on the server changes the task's run times; the history query refetches then.
  useEffect(() => {
    if (seenKey.current === refreshKey) return;
    seenKey.current = refreshKey;
    refresh();
  }, [refreshKey, refresh]);
  const [older, setOlder] = useState<ReadonlyArray<ScheduledTaskRunId>>([]);
  const firstPage = runs.data?.runs ?? [];
  const home = automationHomeThread(task, firstPage);
  const offHere =
    thread !== null && (task.disabledThreadIds ?? []).some((id) => id === thread.threadId);
  const scheduleType = task.schedule.type;
  const reachesThread =
    thread !== null &&
    scheduleType === "event" &&
    task.schedule.event !== "status_transition" &&
    task.threadId !== thread.threadId;
  const scopeLabel =
    task.threadId !== null && scheduledTaskThreadMode(task) !== "new_thread"
      ? (boundShell?.title ?? "One thread")
      : `in ${project?.title ?? "its project"}`;
  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                autoFocus
                aria-label="Back to automations"
                onClick={onBack}
              />
            }
          >
            <ArrowLeftIcon />
            Back
          </TooltipTrigger>
          <TooltipPopup>Back to automations · Esc</TooltipPopup>
        </Tooltip>
        <span className="flex-1" />
        <Switch
          size="sm"
          checked={task.enabled}
          disabled={!actions.canOperate || actions.busy}
          aria-label={task.enabled ? `Pause ${task.title}` : `Resume ${task.title}`}
          onCheckedChange={(enabled) => void actions.setEnabled(task, enabled)}
        />
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!actions.canOperate || actions.busy}
                aria-label={`Actions for ${task.title}`}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {scheduleType === "webhook" ? null : (
              <MenuItem
                disabled={task.lastRunStatus === "running"}
                onClick={() => void actions.runNow(task)}
              >
                Run now
              </MenuItem>
            )}
            <MenuItem
              onClick={() =>
                void navigate({
                  to: "/settings/scheduled-tasks",
                  search: { environmentId, taskId: task.id },
                })
              }
            >
              Edit
            </MenuItem>
            {reachesThread ? (
              <MenuItem
                onClick={() =>
                  void actions.setThreadEnabled(task, ThreadId.make(thread.threadId), offHere)
                }
              >
                {offHere ? "On for this thread" : "Off for this thread"}
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              onClick={() =>
                void actions.remove(task).then((removed) => {
                  if (removed) useThreadContextSidebarStore.getState().selectAutomation(null);
                })
              }
            >
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={<h3 className="line-clamp-2 break-words text-sm font-medium text-foreground" />}
        >
          {task.title}
        </TooltipTrigger>
        <TooltipPopup>{task.title}</TooltipPopup>
      </Tooltip>
      <dl className="space-y-0.5 text-muted-foreground [&_dd]:break-words [&_dt]:sr-only">
        <dt>Trigger and scope</dt>
        <dd>
          {scheduleLabel(task.schedule, timeZone, task.nextRunAt)} · {scopeLabel}
        </dd>
        <dt>Model</dt>
        <dd>{formatModelSlugName(task.modelSelection.model)}</dd>
        <dt>Thread mode</dt>
        <dd>{THREAD_MODE_LABELS[scheduledTaskThreadMode(task)]}</dd>
        {!task.enabled || offHere || task.blockedByPolicy !== undefined ? (
          <>
            <dt>State</dt>
            <dd>{task.blockedByPolicy ?? (task.enabled ? "Off for this thread" : "Paused")}</dd>
          </>
        ) : null}
      </dl>
      {task.lastRunError ? (
        <p className="break-words text-destructive">{task.lastRunError}</p>
      ) : null}
      {home !== null ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={() => void openThread(environmentId, home)}>
            Open thread
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void openThread(environmentId, home, true)}
          >
            Message…
          </Button>
        </div>
      ) : null}
      <section className="space-y-1" aria-label="Runs">
        <SectionHeading>Runs</SectionHeading>
        {runs.error !== null ? (
          <p className="text-destructive">Could not load runs: {runs.error}</p>
        ) : runs.data === null ? (
          <p className="text-muted-foreground">Loading runs…</p>
        ) : firstPage.length === 0 ? (
          <p className="text-muted-foreground">No runs yet.</p>
        ) : (
          <RunList
            environmentId={environmentId}
            runs={firstPage}
            hasMore={runs.data.hasMore && older.length === 0}
            onLoadOlder={(before) => setOlder([before])}
          />
        )}
        {older.map((before, index) => (
          <OlderRuns
            key={before}
            environmentId={environmentId}
            taskId={task.id}
            before={before}
            last={index === older.length - 1}
            onLoadOlder={(next) => setOlder((pages) => [...pages, next])}
          />
        ))}
      </section>
    </div>
  );
}

function OlderRuns(props: {
  environmentId: EnvironmentId;
  taskId: ScheduledTask["id"];
  before: ScheduledTaskRunId;
  last: boolean;
  onLoadOlder: (before: ScheduledTaskRunId) => void;
}) {
  const page = useEnvironmentQuery(
    serverEnvironment.scheduledTaskRuns({
      environmentId: props.environmentId,
      input: { id: props.taskId, before: props.before },
    }),
  );
  if (page.error !== null) return <p className="text-destructive">{page.error}</p>;
  if (page.data === null) return <p className="text-muted-foreground">Loading runs…</p>;
  return (
    <RunList
      environmentId={props.environmentId}
      runs={page.data.runs}
      hasMore={page.data.hasMore && props.last}
      onLoadOlder={props.onLoadOlder}
      takeFocus
    />
  );
}

const RUN_ICONS: Record<string, { icon: ReactNode; tone: string }> = {
  running: { icon: <CircleDotIcon />, tone: "text-info" },
  quiet: { icon: <CheckIcon />, tone: "text-success" },
  notified: { icon: <TriangleAlertIcon />, tone: "text-warning" },
  suppressed: { icon: <BanIcon />, tone: "text-muted-foreground" },
  skipped: { icon: <SkipForwardIcon />, tone: "text-muted-foreground" },
};
const FAILED_ICON = { icon: <XIcon />, tone: "text-destructive" };

// Module-level so React calls it once on mount, not again on every render.
const focusOnMount = (element: HTMLElement | null) => element?.focus();

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function runTimeLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - date.getTime()) / 86_400_000) + 1;
  const time = timeFormat.format(date);
  if (date >= today) return `Today ${time}`;
  if (days <= 1) return `Yesterday ${time}`;
  if (days < 7) return `${weekdayFormat.format(date)} ${time}`;
  return `${dateFormat.format(date)} ${time}`;
}

function RunList(props: {
  environmentId: EnvironmentId;
  runs: ReadonlyArray<ScheduledTaskRun>;
  hasMore: boolean;
  onLoadOlder: (before: ScheduledTaskRunId) => void;
  /** An older page takes focus from the Load older button it replaces. */
  takeFocus?: boolean;
}) {
  const openThread = useOpenThread();
  const last = props.runs.at(-1);
  return (
    <>
      <ul
        className="m-0 list-none space-y-0.5 p-0 outline-none"
        tabIndex={props.takeFocus ? -1 : undefined}
        ref={props.takeFocus ? focusOnMount : undefined}
      >
        {props.runs.map((run) => {
          const { icon, tone } = RUN_ICONS[run.status] ?? FAILED_ICON;
          const cost = runCostLabel(run);
          const detail = run.error ?? run.trigger.summary;
          const content = (
            <>
              <span aria-hidden className={cn("mt-0.5 shrink-0 [&_svg]:size-3.5", tone)}>
                {icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 gap-2">
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {runTimeLabel(run.startedAt)}
                  </span>
                  {cost ? <span className="shrink-0 tabular-nums">{cost}</span> : null}
                </span>
                <span
                  className={cn(
                    "block text-muted-foreground",
                    run.error ? "line-clamp-3 break-words" : "truncate",
                  )}
                >
                  {runOutcomeLabel(run)}
                  {detail ? ` · ${detail}` : ""}
                </span>
              </span>
            </>
          );
          return (
            <li key={run.id}>
              {run.threadId === null ? (
                <div className="flex min-w-0 items-start gap-2 px-1.5 py-1">{content}</div>
              ) : (
                <button
                  type="button"
                  className="flex w-full min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-left outline-hidden ring-ring hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset"
                  onClick={() => run.threadId && void openThread(props.environmentId, run.threadId)}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {props.hasMore && last ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => props.onLoadOlder(ScheduledTaskRunId.make(last.id))}
        >
          Load older
        </Button>
      ) : null}
    </>
  );
}
