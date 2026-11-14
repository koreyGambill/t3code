import { useNavigate } from "@tanstack/react-router";
import type { AutomationThreadContext } from "@t3tools/client-runtime/automations";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import { PlusIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { cn } from "../../lib/utils";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useThreadContextSidebarStore } from "../../threadContextSidebarStore";
import { ScheduledRelativeLabel } from "../settings/ScheduledTasksSettings";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { SectionHeading } from "../ThreadToolViews";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription } from "../ui/empty";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type AutomationRowModel,
  type AutomationScope,
  automationSections,
  compactScheduleLabel,
} from "./automationsView.logic";
import { type AutomationActions, automationRowKey, useAutomationActions } from "./useAutomations";

export function EnvironmentAutomations(props: {
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
  const actions = useAutomationActions(props.environmentId);
  const navigate = useNavigate();
  const sections = automationSections(query.data?.tasks ?? [], props);
  const empty = sections.on.length === 0 && sections.off.length === 0;
  const unfiltered = props.filter.trim() === "" && props.showPaused;
  const row = (model: AutomationRowModel, offHere: boolean) => (
    <AutomationRow
      key={model.task.id}
      row={model}
      offHere={offHere}
      environmentId={props.environmentId}
      timeZone={query.data?.timeZone}
      thread={props.thread}
      actions={actions}
    />
  );
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
        // One keyed list, so a row that changes section keeps its instance and focus target.
        [
          props.scope === "thread" && sections.on.length > 0 ? (
            <SectionHeading key="heading:on">For this thread</SectionHeading>
          ) : null,
          ...sections.on.map((model) => row(model, false)),
          sections.off.length > 0 ? (
            <div key="heading:off" className="pt-3">
              <SectionHeading>Off for this thread</SectionHeading>
            </div>
          ) : null,
          ...sections.off.map((model) => row(model, true)),
        ]
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
  offHere,
  environmentId,
  timeZone,
  thread,
  actions,
}: {
  row: AutomationRowModel;
  offHere: boolean;
  environmentId: EnvironmentId;
  timeZone: string | undefined;
  thread: AutomationThreadContext | null;
  actions: AutomationActions;
}) {
  const { task, applies } = row;
  const perThread = applies === "event" && thread !== null;
  const lit = task.enabled && !offHere;
  const switchRef = useRef<HTMLButtonElement>(null);
  const refocusSwitch = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Moving the row to the other section re-inserts its DOM node, which drops focus; the switch that moved it takes focus back.
  useLayoutEffect(() => {
    if (!refocusSwitch.current) return;
    refocusSwitch.current = false;
    switchRef.current?.focus();
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The row's section changing is the moment its switch loses focus.
    offHere,
  ]);
  const offCount = task.disabledThreadIds?.length ?? 0;
  // Rows are narrow; the vendor prefix costs the trigger its room. Detail shows the full name.
  const model = formatModelSlugName(task.modelSelection.model).replace(/^Claude /, "");
  const trigger =
    compactScheduleLabel(task.schedule) ?? scheduleLabel(task.schedule, timeZone, task.nextRunAt);
  const pausedEverywhere = perThread && !task.enabled;
  const toggle = (
    <Switch
      ref={switchRef}
      size="sm"
      checked={lit}
      disabled={pausedEverywhere || !actions.canOperate || actions.busy}
      aria-label={
        perThread
          ? `${lit ? "Turn off" : "Turn on"} ${task.title} for this thread`
          : `${task.enabled ? "Pause" : "Resume"} ${task.title}`
      }
      onCheckedChange={(next) => {
        if (!perThread || thread === null) return void actions.setEnabled(task, next);
        refocusSwitch.current = true;
        void actions.setThreadEnabled(task, thread.threadId, next);
      }}
    />
  );
  return (
    <div className="group/row relative min-w-0 rounded-md hover:bg-muted/40 focus-within:bg-muted/40">
      <button
        type="button"
        data-automation-row={automationRowKey(environmentId, task.id)}
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
            {task.enabled ? (offHere ? "off here · " : "") : "paused · "}
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
        {pausedEverywhere ? (
          <Tooltip>
            {/* A disabled switch takes no pointer events, so the wrapper carries the hint. */}
            <TooltipTrigger render={<span className="flex" />}>{toggle}</TooltipTrigger>
            <TooltipPopup side="left">Paused everywhere. Resume it in its detail.</TooltipPopup>
          </Tooltip>
        ) : (
          toggle
        )}
      </span>
    </div>
  );
}
