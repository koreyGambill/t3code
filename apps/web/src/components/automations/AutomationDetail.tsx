import { useNavigate } from "@tanstack/react-router";
import {
  automationAppliesTo,
  automationOffForThread,
  type AutomationThreadContext,
} from "@t3tools/client-runtime/automations";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  ProjectId,
  type ScheduledTask,
  scheduledTaskThreadMode,
} from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import { ArrowLeftIcon, MoreHorizontalIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { useProject, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useThreadContextSidebarStore } from "../../threadContextSidebarStore";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { SectionHeading } from "../ThreadToolViews";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AutomationRunList } from "./AutomationRunList";
import { automationHomeThread, THREAD_MODE_LABELS } from "./automationsView.logic";
import { useAutomationActions, useOpenThread } from "./useAutomations";

export function AutomationDetail({
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
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-2.5 text-xs">
      {task === null ? (
        <div className="space-y-2">
          <Button size="xs" variant="ghost" autoFocus onClick={onBack}>
            <ArrowLeftIcon />
            Back
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
  const boundShell = useQuietThreadShell(
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
  const runList = runs.data?.runs ?? [];
  const home = automationHomeThread(task, runList);
  const perThread = thread !== null && automationAppliesTo(task, thread) === "event";
  const offHere = perThread && automationOffForThread(task, thread.threadId);
  const scopeLabel =
    task.threadId !== null && scheduledTaskThreadMode(task) !== "new_thread"
      ? (boundShell?.title ?? "One thread")
      : `in ${project?.title ?? "its project"}`;
  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          autoFocus
          aria-label="Back to automations"
          aria-keyshortcuts="Escape"
          onClick={onBack}
        >
          <ArrowLeftIcon />
          Back
        </Button>
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
            {task.schedule.type === "webhook" ? null : (
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
            {perThread ? (
              <MenuItem
                onClick={() => void actions.setThreadEnabled(task, thread.threadId, offHere)}
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
        ) : runList.length === 0 ? (
          <p className="text-muted-foreground">No runs yet.</p>
        ) : (
          <AutomationRunList
            environmentId={environmentId}
            runs={runList}
            hasMore={runs.data.hasMore}
          />
        )}
      </section>
    </div>
  );
}
