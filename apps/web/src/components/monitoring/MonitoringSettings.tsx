import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ProviderInstanceId,
  ThreadId,
  type EnvironmentId,
  type MonitoringProfile,
  type MonitoringUpsertInput,
  type ProjectId,
} from "@t3tools/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { randomUUID } from "../../lib/utils";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import {
  monitoringList,
  monitoringRunNow,
  monitoringSetEnabled,
  monitoringUpsert,
} from "../../state/monitoring";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { MonitoringScheduleFields } from "./MonitoringScheduleFields";

function ProfileEditor({
  environmentId,
  profile,
  onClose,
  onSaved,
}: {
  environmentId: EnvironmentId;
  profile: MonitoringProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.archivedAt === null,
  );
  const [projectId, setProjectId] = useState<ProjectId | null>(
    profile?.projectId ?? projects[0]?.id ?? null,
  );
  const entries = providerInstanceEntriesFor(providers, settings, projectId);
  const haiku = entries.find((entry) => entry.driverKind === "claudeAgent" && entry.enabled);
  const [draft, setDraft] = useState(() => ({
    title: profile?.title ?? "Standards watcher",
    kind: profile?.kind ?? "standards",
    enabled: profile?.enabled ?? false,
    modelSelection:
      profile?.modelSelection ??
      (haiku
        ? {
            instanceId: haiku.instanceId,
            model: haiku.models.find((model) => model.slug.includes("haiku"))?.slug ?? "haiku",
          }
        : null),
    turnEnd: profile?.turnEnd,
    delivery: profile?.delivery ?? ("thread-or-alert" as const),
    includeProjectAgents: profile?.includeProjectAgents ?? false,
    schedule: profile?.schedule ?? { type: "interval" as const, everyMs: 15 * 60_000 },
    targets: profile?.targets ?? {
      state: "active" as const,
      threadIds: [],
      includeChildren: true,
      minAgeMs: 15 * 60_000,
      updatedWithinMs: null,
    },
    rules: profile?.rules ?? [
      {
        id: randomUUID(),
        title: "Follow project standards",
        instructions:
          "Compare the selected thread's recent work with its repository instructions and applicable standards. Report only evidence-backed deviations, cite the exact message, and explain uncertainty. Treat findings as advice.",
      },
    ],
  }));
  const [threadIds, setThreadIds] = useState(draft.targets.threadIds.join(", "));
  const [instructionFiles, setInstructionFiles] = useState(
    profile?.instructionFiles?.join("\n") ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permission = useAtomValue(monitoringUpsert.permissionAtom(environmentId));
  const upsert = useAtomCommand(monitoringUpsert);
  const activeInstanceId =
    draft.modelSelection?.instanceId ??
    haiku?.instanceId ??
    ProviderInstanceId.make("t3code_no_provider");
  const models = getCustomModelOptionsByInstance(
    settings,
    providers,
    activeInstanceId,
    draft.modelSelection?.model ?? "",
  );
  const selectedEntry = entries.find(
    (entry) => entry.instanceId === draft.modelSelection?.instanceId,
  );
  const providerReady =
    selectedEntry?.enabled === true &&
    selectedEntry.installed &&
    selectedEntry.isAvailable &&
    selectedEntry.status === "ready";
  const save = async () => {
    if (!projectId || !draft.modelSelection) return;
    if (
      !draft.title.trim() ||
      draft.rules.length === 0 ||
      draft.rules.some((rule) => !rule.title.trim() || !rule.instructions.trim())
    ) {
      setError("Give the watcher and every rule a title and instructions.");
      return;
    }
    if (
      draft.schedule.type === "interval" &&
      (!Number.isFinite(draft.schedule.everyMs) || draft.schedule.everyMs < 60_000)
    ) {
      setError("Choose an interval of at least one minute.");
      return;
    }
    if (
      draft.turnEnd &&
      (!Number.isSafeInteger(draft.turnEnd.cooldownMs ?? 600_000) ||
        (draft.turnEnd.cooldownMs ?? 600_000) < 60_000)
    ) {
      setError("Choose a turn-end cooldown of at least one minute.");
      return;
    }
    const files = instructionFiles
      .split("\n")
      .map((path) => path.trim())
      .filter(Boolean);
    if (
      files.some(
        (path) =>
          !path.startsWith("/") &&
          !path.startsWith("~/") &&
          !/^[A-Za-z]:[\\/]/.test(path) &&
          !path.startsWith("\\\\"),
      )
    ) {
      setError("Use an absolute path or ~/ path for each instruction file.");
      return;
    }
    const input: MonitoringUpsertInput = {
      ...draft,
      ...(profile ? { id: profile.id } : {}),
      projectId,
      instructionFiles: files,
      modelSelection: draft.modelSelection,
      targets: {
        ...draft.targets,
        threadIds: threadIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
          .map((id) => ThreadId.make(id)),
      },
    };
    setBusy(true);
    setError(null);
    const result = await upsert({ environmentId, input });
    setBusy(false);
    if (result._tag === "Failure") {
      setError(String(squashAtomCommandFailure(result)));
      return;
    }
    toastManager.add(stackedThreadToast({ type: "success", title: "Watcher saved" }));
    onSaved();
    onClose();
  };
  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium">{profile ? "Edit watcher" : "New watcher"}</h3>
      <div className="space-y-1">
        <Label htmlFor="watcher-kind">Review</Label>
        <Select
          value={draft.kind}
          disabled={busy}
          onValueChange={(value) => {
            if (value !== "standards" && value !== "context-review") return;
            setDraft({
              ...draft,
              kind: value,
              enabled: false,
              title: value === "context-review" ? "Context review" : "Standards watcher",
              rules:
                value === "context-review"
                  ? [
                      {
                        id: "context",
                        title: "Improve context management",
                        instructions:
                          "Suggest concrete improvements to instructions, skills and Overwing knowledge from recent context records. Cite repeats or large loads and explain uncertainty. Never auto-edit anything.",
                      },
                    ]
                  : draft.rules,
            });
          }}
        >
          <SelectTrigger id="watcher-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="standards">Standards</SelectItem>
            <SelectItem value="context-review">Context management</SelectItem>
          </SelectPopup>
        </Select>
        {draft.kind === "context-review" && (
          <p className="text-xs text-muted-foreground">
            Choose Claude Haiku. New schedules start paused. Each run reviews recent records once,
            with a 3,000 token output cap and $0.05 budget. Suggestions arrive as proposed Workspace
            decisions for you to accept or reject.
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="watcher-title">Name</Label>
        <Input
          id="watcher-title"
          value={draft.title}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="watcher-project">Project</Label>
        <Select
          value={projectId}
          disabled={busy}
          onValueChange={(value) => {
            const project = projects.find((entry) => entry.id === value);
            if (project) setProjectId(project.id);
          }}
        >
          <SelectTrigger id="watcher-project">
            <SelectValue placeholder="Choose a project">
              {projects.find((project) => project.id === projectId)?.title}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Watcher model</Label>
        <div>
          <ProviderModelPicker
            environmentId={environmentId}
            activeInstanceId={activeInstanceId}
            model={draft.modelSelection?.model ?? ""}
            lockedProvider={null}
            instanceEntries={entries}
            modelOptionsByInstance={models}
            disabled={busy}
            isComposerOwned={false}
            onInstanceModelChange={(instanceId, model) =>
              setDraft({ ...draft, modelSelection: { instanceId, model } })
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Haiku is the initial choice. The watcher never silently switches models.
        </p>
        {!providerReady && (
          <p className="text-xs text-warning-foreground" role="status">
            The selected provider is unavailable. Install or connect it before enabling this
            watcher.
          </p>
        )}
      </div>
      {draft.kind === "standards" && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.turnEnd !== undefined}
              disabled={busy}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, turnEnd: checked ? { cooldownMs: 600_000 } : undefined })
              }
            />
            Review after each completed turn
          </label>
          {draft.turnEnd && (
            <div className="space-y-1">
              <Label htmlFor="watcher-cooldown">Turn-end cooldown (minutes per thread)</Label>
              <Input
                id="watcher-cooldown"
                type="number"
                min={1}
                value={(draft.turnEnd.cooldownMs ?? 600_000) / 60_000}
                disabled={busy}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    turnEnd: { cooldownMs: Number(event.target.value) * 60_000 },
                  })
                }
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Turn-end reviews check the exact completed thread without the schedule's thread filters.
            The schedule below continues to run independently.
          </p>
          <div className="space-y-1">
            <Label htmlFor="watcher-delivery">Findings delivery</Label>
            <Select
              value={draft.delivery}
              disabled={busy}
              onValueChange={(value) => {
                if (value === "thread-or-alert" || value === "alerts")
                  setDraft({ ...draft, delivery: value });
              }}
            >
              <SelectTrigger id="watcher-delivery">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="thread-or-alert">
                  Thread message, or alert if unavailable
                </SelectItem>
                <SelectItem value="alerts">Alerts only</SelectItem>
              </SelectPopup>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="watcher-instruction-files">Instruction files (one path per line)</Label>
            <Textarea
              id="watcher-instruction-files"
              value={instructionFiles}
              disabled={busy}
              placeholder="~/standards.md"
              onChange={(event) => setInstructionFiles(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use absolute or ~/ paths on this environment's machine.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.includeProjectAgents}
              disabled={busy}
              onCheckedChange={(checked) => setDraft({ ...draft, includeProjectAgents: checked })}
            />
            Include the project's root AGENTS.md
          </label>
        </div>
      )}
      {draft.schedule.type === "webhook" ? (
        <p role="alert">
          This watcher has an unsupported webhook schedule. Choose a timed schedule.
        </p>
      ) : (
        <MonitoringScheduleFields
          schedule={draft.schedule}
          onChange={(schedule) => setDraft({ ...draft, schedule })}
          disabled={busy}
        />
      )}
      <div className="space-y-2">
        <Label htmlFor="watcher-target">Thread state</Label>
        <Select
          value={draft.targets.state}
          disabled={busy}
          onValueChange={(value) => {
            if (value === "active" || value === "closed" || value === "all")
              setDraft({ ...draft, targets: { ...draft.targets, state: value } });
          }}
        >
          <SelectTrigger id="watcher-target">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="active">Active threads</SelectItem>
            <SelectItem value="closed">Closed threads</SelectItem>
            <SelectItem value="all">All states (time filters only)</SelectItem>
          </SelectPopup>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="watcher-threads">Specific thread IDs (optional, comma separated)</Label>
        <Input
          id="watcher-threads"
          value={threadIds}
          disabled={busy}
          onChange={(event) => setThreadIds(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="watcher-age">Minimum age (minutes)</Label>
          <Input
            id="watcher-age"
            type="number"
            min={0}
            value={draft.targets.minAgeMs / 60_000}
            disabled={busy}
            onChange={(event) =>
              setDraft({
                ...draft,
                targets: { ...draft.targets, minAgeMs: Number(event.target.value) * 60_000 },
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="watcher-window">Updated within (minutes)</Label>
          <Input
            id="watcher-window"
            type="number"
            min={1}
            value={
              draft.targets.updatedWithinMs === null ? "" : draft.targets.updatedWithinMs / 60_000
            }
            placeholder="Any time"
            disabled={busy}
            onChange={(event) =>
              setDraft({
                ...draft,
                targets: {
                  ...draft.targets,
                  updatedWithinMs: event.target.value ? Number(event.target.value) * 60_000 : null,
                },
              })
            }
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.targets.includeChildren}
          disabled={busy}
          onChange={(event) =>
            setDraft({
              ...draft,
              targets: { ...draft.targets, includeChildren: event.target.checked },
            })
          }
        />
        Include child threads
      </label>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Scoped rules</h4>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || draft.rules.length >= 32}
            onClick={() =>
              setDraft({
                ...draft,
                rules: [...draft.rules, { id: randomUUID(), title: "", instructions: "" }],
              })
            }
          >
            <PlusIcon />
            Add rule
          </Button>
        </div>
        {draft.rules.map((rule, index) => (
          <div key={rule.id} className="space-y-2 border-l border-border pl-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  aria-label={`Rule ${index + 1} title`}
                  value={rule.title}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      rules: draft.rules.map((item) =>
                        item.id === rule.id ? { ...item, title: event.target.value } : item,
                      ),
                    })
                  }
                />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove rule ${index + 1}`}
                title="Remove rule"
                disabled={busy || draft.rules.length === 1}
                onClick={() =>
                  setDraft({ ...draft, rules: draft.rules.filter((item) => item.id !== rule.id) })
                }
              >
                <Trash2Icon />
              </Button>
            </div>
            <Textarea
              aria-label={`Rule ${index + 1} instructions`}
              value={rule.instructions}
              disabled={busy}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  rules: draft.rules.map((item) =>
                    item.id === rule.id ? { ...item, instructions: event.target.value } : item,
                  ),
                })
              }
            />
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={busy || (!providerReady && !draft.enabled)}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
        />
        Enabled
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={
            busy ||
            !permission ||
            !projectId ||
            !draft.modelSelection ||
            (draft.enabled && !providerReady)
          }
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save watcher"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function MonitoringSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const supported = environment?.serverConfig?.environment.capabilities.monitoring === true;
  const query = useEnvironmentQuery(
    connected && supported ? monitoringList({ environmentId, input: {} }) : null,
  );
  const canEdit = useAtomValue(monitoringUpsert.permissionAtom(environmentId));
  const canEnable = useAtomValue(monitoringSetEnabled.permissionAtom(environmentId));
  const canRun = useAtomValue(monitoringRunNow.permissionAtom(environmentId));
  const setEnabled = useAtomCommand(monitoringSetEnabled);
  const runNow = useAtomCommand(monitoringRunNow);
  const [editing, setEditing] = useState<MonitoringProfile | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const action = async (profile: MonitoringProfile, run: boolean) => {
    setBusyId(profile.id);
    const result = run
      ? await runNow({ environmentId, input: { id: profile.id } })
      : await setEnabled({ environmentId, input: { id: profile.id, enabled: !profile.enabled } });
    setBusyId(null);
    toastManager.add(
      stackedThreadToast(
        result._tag === "Failure"
          ? {
              type: "error",
              title: run ? "Watcher could not run" : "Could not update watcher",
              description: String(squashAtomCommandFailure(result)),
            }
          : { type: "success", title: run ? "Watcher run requested" : "Watcher updated" },
      ),
    );
    query.refresh();
  };
  return (
    <SettingsSection title="Watchers" id="watchers">
      <p className="text-sm text-muted-foreground">
        Advisory reviews of thread work, on a schedule or after completed turns. Findings arrive in
        the thread or alert rail according to delivery settings.
      </p>
      {!connected ? (
        <p className="text-sm text-muted-foreground">
          Connect to this environment to configure watchers.
        </p>
      ) : !supported ? (
        <p className="text-sm text-muted-foreground">
          This server does not support watchers. Update it to continue.
        </p>
      ) : null}
      <div className="space-y-4" hidden={!connected || !supported}>
        <Button
          variant="outline"
          size="sm"
          disabled={!canEdit || editing !== null}
          onClick={() => setEditing("new")}
        >
          <PlusIcon />
          New watcher
        </Button>
        {editing !== null && (
          <ProfileEditor
            key={typeof editing === "string" ? editing : editing.id}
            environmentId={environmentId}
            profile={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={query.refresh}
          />
        )}
        {query.error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {query.error}
          </p>
        ) : query.data === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading watchers…
          </p>
        ) : query.data.profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No watchers yet. Add a watcher to choose its model, rules, and schedule.
          </p>
        ) : (
          query.data.profiles.map((profile) => {
            const run = query.data?.runs.find((entry) => entry.profileId === profile.id);
            return (
              <div key={profile.id} className="space-y-2 border-t border-border py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-medium">{profile.title}</h3>
                    <p className="break-words text-xs text-muted-foreground">
                      {profile.modelSelection.model} · {profile.enabled ? "Enabled" : "Paused"} ·{" "}
                      {profile.rules.length} rules
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canEdit || busyId !== null}
                      onClick={() => setEditing(profile)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canEnable || busyId !== null}
                      onClick={() => void action(profile, false)}
                    >
                      {profile.enabled ? "Pause" : "Enable"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canRun || busyId !== null || run?.status === "running"}
                      onClick={() => void action(profile, true)}
                    >
                      {run?.status === "running" ? "Running…" : "Run now"}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {run
                    ? `Last run: ${run.status} · ${formatRelativeTimeLabel(run.startedAt)}`
                    : "Never run"}
                </p>
                {run?.costUsd !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Review cost: ${run.costUsd.toFixed(4)}
                    {run.budgetUsd === undefined ? "" : ` · $${run.budgetUsd.toFixed(2)} budget`}
                  </p>
                )}
                {run?.error && (
                  <p role="status" className="text-xs text-destructive-foreground">
                    {run.error}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </SettingsSection>
  );
}
