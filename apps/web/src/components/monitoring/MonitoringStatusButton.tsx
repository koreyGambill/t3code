import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import type {
  EnvironmentId,
  MonitoringFinding,
  MonitoringListResult,
  MonitoringSetDispositionInput,
  ThreadId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ActivityIcon, ChevronLeftIcon, Settings2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AsyncResult } from "effect/reactivity";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironment, usePrimaryEnvironmentId, useEnvironments } from "../../state/environments";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import {
  monitoringList,
  monitoringStatus,
  monitoringSetDisposition,
  monitoringSetEnabled,
} from "../../state/monitoring";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { StatusSourceDot } from "../statusSources/StatusSourceIcon";
import { StatusSourcesList, useStatusSourceGroups } from "../statusSources/StatusSources";
import { summarizeStatusSources } from "../statusSources/statusSourceSummary.logic";
import { useEnvironmentsWithScope } from "../../state/session";

import { visibleMonitoringFindings } from "./monitoring.logic";

const monitoringStatusesAtom = environmentAtomList("web-monitoring-statuses", (environmentId) =>
  monitoringStatus({ environmentId, input: {} }),
);

function ObservationTime({ at }: { at: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<time dateTime={at} tabIndex={0} />}>
        {formatRelativeTimeLabel(at)}
      </TooltipTrigger>
      <TooltipPopup>{new Date(at).toLocaleString()}</TooltipPopup>
    </Tooltip>
  );
}

function FindingReport({
  finding,
  data,
  onOpenThread,
}: {
  finding: MonitoringFinding;
  data: MonitoringListResult;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const run = data.runs.find((entry) => entry.id === finding.runId);
  const profile = run?.profile ?? data.profiles.find((entry) => entry.id === finding.profileId);
  const rule = finding.ruleSnapshot ?? profile?.rules.find((entry) => entry.id === finding.ruleId);
  return (
    <div className="space-y-4 p-3 text-sm">
      <div className="space-y-2">
        <h3 className="font-medium break-words">{finding.summary}</h3>
        <div className="flex flex-wrap gap-1">
          <Badge variant="warning">Advisory</Badge>
          <Badge variant="secondary">{Math.round(finding.confidence * 100)}% confidence</Badge>
          <Badge variant="outline">{finding.disposition}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          A watcher sees limited thread context. You can ignore this observation.
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Watcher</dt>
        <dd className="break-words">{profile?.title ?? finding.profileId}</dd>
        <dt className="text-muted-foreground">Model</dt>
        <dd className="break-words">
          {profile
            ? `${profile.modelSelection.model} · ${profile.modelSelection.instanceId}`
            : "Provenance unavailable"}
        </dd>
        <dt className="text-muted-foreground">Schedule</dt>
        <dd>
          {profile?.schedule.type === "interval"
            ? `Every ${profile.schedule.everyMs / 60_000} minutes`
            : profile?.schedule.type === "fixed_time"
              ? `At ${profile.schedule.timeOfDay}`
              : profile?.schedule.type === "once"
                ? profile.schedule.runAt
                : "Unavailable"}
        </dd>
        <dt className="text-muted-foreground">Rule</dt>
        <dd className="break-words">{rule?.title ?? finding.ruleId}</dd>
        <dt className="text-muted-foreground">Observed</dt>
        <dd>
          <ObservationTime at={finding.createdAt} />
        </dd>
        <dt className="text-muted-foreground">Run</dt>
        <dd className="break-all">
          {finding.runId}
          {run ? ` · ${run.status}` : ""}
        </dd>
        <dt className="text-muted-foreground">Thread</dt>
        <dd>
          <button
            type="button"
            className="break-all text-left text-primary hover:underline"
            onClick={() => onOpenThread(finding.threadId)}
          >
            {finding.threadId}
          </button>
        </dd>
      </dl>
      {rule && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Scoped rule instructions
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words">{rule.instructions}</p>
        </details>
      )}
      <section className="space-y-2">
        <h4 className="font-medium">Observation</h4>
        <p className="whitespace-pre-wrap break-words">{finding.detail}</p>
      </section>
      <section className="space-y-2">
        <h4 className="font-medium">Evidence</h4>
        {finding.evidence.map((evidence) => (
          <div
            key={`${evidence.threadId}:${evidence.messageId}:${evidence.excerpt}`}
            className="space-y-1 border-l border-border pl-3"
          >
            <p className="whitespace-pre-wrap break-words text-secondary-label">
              {evidence.excerpt}
            </p>
            <button
              type="button"
              className="break-all text-left text-xs text-primary hover:underline"
              onClick={() => onOpenThread(evidence.threadId)}
            >
              Open source · {evidence.messageId}
            </button>
          </div>
        ))}
      </section>
      <section className="space-y-2">
        <h4 className="font-medium">Discussion</h4>
        {finding.sentToThread && (
          <div className="space-y-1 border-l border-primary pl-3">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>Watcher → thread</span>
              <ObservationTime at={finding.sentToThread.at} />
            </div>
            <p className="whitespace-pre-wrap break-words">{finding.summary}</p>
            <button
              type="button"
              className="break-all text-left text-xs text-primary hover:underline"
              onClick={() => onOpenThread(finding.threadId)}
            >
              Open sent message
            </button>
          </div>
        )}
        {finding.exchanges.length === 0 && !finding.sentToThread ? (
          <p className="text-muted-foreground">No lead response yet.</p>
        ) : (
          finding.exchanges.map((exchange) => (
            <div key={exchange.id} className="space-y-1 border-l border-border pl-3">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>
                  {exchange.role === "agent"
                    ? "Lead agent"
                    : exchange.role === "monitor"
                      ? "Watcher"
                      : "You"}
                </span>
                <ObservationTime at={exchange.at} />
              </div>
              <p className="whitespace-pre-wrap break-words">{exchange.text}</p>
            </div>
          ))
        )}
      </section>
      <section className="space-y-2">
        <h4 className="font-medium">Outcome</h4>
        <p className="whitespace-pre-wrap break-words">
          {finding.outcome === "accepted_explanation"
            ? "Accepted explanation"
            : finding.outcome === "corrected"
              ? "Corrected"
              : finding.outcome === "unresolved"
                ? "Unresolved"
                : "Unverified · no verified correction."}
        </p>
        <p className="text-xs text-muted-foreground">
          An agreement or promise alone does not verify a correction.
        </p>
      </section>
    </div>
  );
}

function EnvironmentAlerts({
  environmentId,
  onOpenThread,
  onConfigure,
}: {
  environmentId: EnvironmentId;
  onOpenThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
  onConfigure: (environmentId: EnvironmentId) => void;
}) {
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const supported = environment?.serverConfig?.environment.capabilities.monitoring === true;
  const query = useEnvironmentQuery(
    connected && supported ? monitoringList({ environmentId, input: {} }) : null,
  );
  const refresh = query.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refresh the server report only while the rail is visible.
  useEffect(() => {
    if (!connected || !supported) return;
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [connected, supported, refresh]);
  const permission = useAtomValue(monitoringSetDisposition.permissionAtom(environmentId));
  const enablePermission = useAtomValue(monitoringSetEnabled.permissionAtom(environmentId));
  const setDisposition = useAtomCommand(monitoringSetDisposition);
  const setEnabled = useAtomCommand(monitoringSetEnabled);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = Date.parse(`${useNowMinute()}Z`);
  const findings = query.data?.findings ?? [];
  const visible = visibleMonitoringFindings(findings, now);
  const unread = visible.filter((finding) => finding.readAt === null).length;
  const selected = findings.find((finding) => finding.id === selectedId);
  const update = async (input: MonitoringSetDispositionInput) => {
    setBusy(true);
    const result = await setDisposition({ environmentId, input });
    setBusy(false);
    toastManager.add(
      stackedThreadToast(
        result._tag === "Failure"
          ? {
              type: "error",
              title: "Could not update alert",
              description: String(squashAtomCommandFailure(result)),
            }
          : { type: "success", title: "Alert updated" },
      ),
    );
    if (result._tag === "Success") query.refresh();
  };
  return (
    <>
      <div className="flex min-h-11 items-center gap-2 border-b border-border px-3">
        {selected && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Back to alerts"
            onClick={() => setSelectedId(null)}
          >
            <ChevronLeftIcon />
          </Button>
        )}
        <h2 className="flex-1 text-sm font-medium">
          Watcher alerts{" "}
          {unread > 0 && <span className="text-muted-foreground">({unread} unread)</span>}
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Configure watchers"
          title="Configure watchers"
          onClick={() => onConfigure(environmentId)}
        >
          <Settings2Icon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!connected ? (
          <p className="p-3 text-sm text-muted-foreground">
            Connect to this environment to load watcher alerts.
          </p>
        ) : !supported ? (
          <p className="p-3 text-sm text-muted-foreground">
            This server does not support watchers. Update the server to configure them.
          </p>
        ) : query.error ? (
          <div className="space-y-2 p-3 text-sm">
            <p role="alert">{query.error}</p>
            <Button size="sm" variant="outline" onClick={query.refresh}>
              Retry
            </Button>
          </div>
        ) : query.data === null ? (
          <p className="p-3 text-sm text-muted-foreground" role="status">
            Loading watcher alerts…
          </p>
        ) : selected ? (
          <>
            <FindingReport
              finding={selected}
              data={query.data}
              onOpenThread={(threadId) => onOpenThread(environmentId, threadId)}
            />
            <div className="flex flex-wrap gap-2 border-t border-border p-3">
              <Button
                size="sm"
                variant="outline"
                disabled={!permission || busy}
                onClick={() =>
                  void update({
                    id: selected.id,
                    disposition:
                      selected.disposition === "dismissed" || selected.disposition === "resolved"
                        ? "open"
                        : "dismissed",
                    snoozedUntil: null,
                  })
                }
              >
                {selected.disposition === "dismissed" || selected.disposition === "resolved"
                  ? "Reopen"
                  : "Dismiss"}
              </Button>
              {selected.snoozedUntil && Date.parse(selected.snoozedUntil) > now ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!permission || busy}
                  onClick={() =>
                    void update({ id: selected.id, disposition: "open", snoozedUntil: null })
                  }
                >
                  Unsnooze
                </Button>
              ) : (
                <Menu>
                  <MenuTrigger
                    render={<Button size="sm" variant="outline" disabled={!permission || busy} />}
                  >
                    Snooze…
                  </MenuTrigger>
                  <MenuPopup>
                    {[15, 60, 1440].map((minutes) => (
                      <MenuItem
                        key={minutes}
                        onClick={() =>
                          void update({
                            id: selected.id,
                            disposition: "open",
                            snoozedUntil: new Date(Date.now() + minutes * 60_000).toISOString(),
                          })
                        }
                      >
                        {minutes === 1440 ? "1 day" : minutes === 60 ? "1 hour" : "15 minutes"}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  !enablePermission ||
                  busy ||
                  !query.data.profiles.some(
                    (profile) => profile.id === selected.profileId && profile.enabled,
                  )
                }
                onClick={async () => {
                  setBusy(true);
                  const result = await setEnabled({
                    environmentId,
                    input: { id: selected.profileId, enabled: false },
                  });
                  setBusy(false);
                  toastManager.add(
                    stackedThreadToast(
                      result._tag === "Failure"
                        ? {
                            type: "error",
                            title: "Could not pause watcher",
                            description: String(squashAtomCommandFailure(result)),
                          }
                        : { type: "success", title: "Watcher paused" },
                    ),
                  );
                  if (result._tag === "Success") query.refresh();
                }}
              >
                Pause watcher
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between p-3">
              <span className="text-xs text-muted-foreground">{environment?.label}</span>
              <Button variant="ghost" size="xs" disabled={query.isPending} onClick={query.refresh}>
                Refresh
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show open" : "Show history"}
              </Button>
            </div>
            {(showAll ? findings : visible).length === 0 ? (
              <div className="space-y-2 p-3 text-sm text-muted-foreground">
                <p>{showAll ? "No watcher observations yet." : "No open watcher alerts."}</p>
                <Button variant="outline" size="sm" onClick={() => onConfigure(environmentId)}>
                  Configure watchers
                </Button>
              </div>
            ) : (
              (showAll ? findings : visible).map((finding) => (
                <button
                  key={finding.id}
                  type="button"
                  className="block w-full space-y-1 border-b border-border px-3 py-3 text-left hover:bg-accent focus-visible:outline-ring"
                  onClick={() => {
                    setSelectedId(finding.id);
                    if (finding.readAt === null && permission)
                      void update({
                        id: finding.id,
                        disposition: finding.disposition,
                        readAt: new Date().toISOString(),
                      });
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 break-words text-sm font-medium">
                      {finding.summary}
                    </span>
                    {finding.readAt === null && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {query.data?.profiles.find((profile) => profile.id === finding.profileId)
                      ?.title ?? "Watcher"}{" "}
                    · {Math.round(finding.confidence * 100)}% ·{" "}
                    <ObservationTime at={finding.createdAt} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {finding.disposition}
                    {finding.snoozedUntil && Date.parse(finding.snoozedUntil) > now
                      ? ` · snoozed until ${new Date(finding.snoozedUntil).toLocaleString()}`
                      : ""}
                  </p>
                </button>
              ))
            )}
          </>
        )}
      </div>
    </>
  );
}

/** The worst status-source state and unread watcher findings across connected environments. */
export function useMonitoringSignal() {
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const connected = environments.filter(
    (entry) =>
      entry.connection.phase === "connected" &&
      entry.serverConfig?.environment.capabilities.monitoring === true &&
      readable.has(entry.environmentId),
  );
  const queries = useAtomValue(
    monitoringStatusesAtom(environmentIdsKey(connected.map((entry) => entry.environmentId))),
  );
  const unread = queries.reduce(
    (count, query) => count + (AsyncResult.getOrElse(query, () => null)?.unreadCount ?? 0),
    0,
  );
  const groups = useStatusSourceGroups();
  const state = summarizeStatusSources(
    groups.flatMap((group) => group.sources ?? []),
    groups.some((group) => group.failed || group.sources === null),
  );
  return { state, unread, groups };
}

export function MonitoringStatusButton() {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(null);
  const selected =
    environments.find((entry) => entry.environmentId === selectedEnvironmentId) ??
    environments.find((entry) => entry.environmentId === environmentId) ??
    environments[0];
  const { state, unread, groups } = useMonitoringSignal();
  const [open, setOpen] = useState(false);
  const label = `Status and alerts: ${state ?? "no sources"}${unread > 0 ? `, ${unread} unread` : ""}`;
  const configureSources = (machine: EnvironmentId) => {
    setOpen(false);
    void navigate({ to: "/settings/status-sources", search: { machine } });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label={label} />}
              />
            }
          >
            <span className="relative inline-flex">
              <ActivityIcon />
              {state && (
                <span className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5">
                  <StatusSourceDot state={state} />
                </span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="right">{label}</TooltipPopup>
        </Tooltip>
        {unread > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-1 -top-1 min-w-3 rounded-full bg-primary px-0.5 text-center text-3xs text-primary-foreground"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </div>
      <PopoverPopup width="lg" padding="none" side="right" align="start">
        <div className="flex max-h-[min(44rem,var(--available-height))] flex-col">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
            <PopoverTitle>Status and alerts</PopoverTitle>
            <PopoverClose
              render={
                <Button variant="ghost" size="icon-xs" aria-label="Close status and alerts" />
              }
            >
              <XIcon />
            </PopoverClose>
          </header>
          <div className="min-h-0 overflow-y-auto">
            <StatusSourcesList groups={groups} onConfigureSources={configureSources} />
            {groups.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">No connected status sources.</p>
            )}
            {selected && (
              <section className="border-t border-border" aria-label="Watcher alerts">
                {environments.length > 1 && (
                  <div className="p-3 pb-0">
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button variant="ghost" size="sm" aria-label="Alerts environment" />
                        }
                      >
                        {selected.label}
                      </MenuTrigger>
                      <MenuPopup>
                        {environments.map((entry) => (
                          <MenuItem
                            key={entry.environmentId}
                            onClick={() => setSelectedEnvironmentId(entry.environmentId)}
                          >
                            {entry.label}
                            {entry.connection.phase !== "connected" ? " · disconnected" : ""}
                          </MenuItem>
                        ))}
                      </MenuPopup>
                    </Menu>
                  </div>
                )}
                <EnvironmentAlerts
                  key={selected.environmentId}
                  environmentId={selected.environmentId}
                  onOpenThread={(destinationEnvironmentId, threadId) => {
                    setOpen(false);
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: { environmentId: destinationEnvironmentId, threadId },
                    });
                  }}
                  onConfigure={(destinationEnvironmentId) => {
                    setOpen(false);
                    void navigate({
                      to: "/settings/scheduled-tasks",
                      search: { environmentId: destinationEnvironmentId },
                    });
                  }}
                />
              </section>
            )}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
