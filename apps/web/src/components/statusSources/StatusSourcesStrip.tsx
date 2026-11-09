import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type StatusSource,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { getClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { statusSources } from "../../state/statusSources";
import { useEnvironmentsWithScope } from "../../state/session";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
} from "../../threadNotifications";
import { Button } from "../ui/button";
import { RelativeTime } from "../RelativeTime";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { StatusSourceDot, StatusSourceIcon } from "./StatusSourceIcon";
import { createStatusSourceNotificationGate } from "./statusSourceNotifications.logic";

function toolUrl(value: string | undefined): string | undefined {
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}

function presentTransition(source: StatusSource, environmentId: EnvironmentId) {
  const { notificationMode, inAppNotificationsEnabled } = getClientSettings();
  const recovered = source.latest.state === "ok";
  const title = `${source.config.name} · ${recovered ? "Recovered" : source.latest.state === "fail" ? "Failed" : "Warning"}`;
  const looking = document.visibilityState === "visible" && document.hasFocus();
  if (looking && inAppNotificationsEnabled) {
    toastManager.add({
      type: recovered ? "success" : source.latest.state === "fail" ? "error" : "warning",
      title,
      description: source.latest.summary,
      data: { hideCopyButton: true },
    });
  } else if (
    !looking &&
    hasDesktopNotifications(notificationMode) &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  ) {
    try {
      const notification = new Notification(title, {
        body: source.latest.summary,
        tag: `status-source:${environmentId}:${source.config.id}`,
        silent: true,
      });
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
        void window.desktopBridge?.revealWindow().catch(() => undefined);
      });
    } catch {
      // Browsers may expose Notification while refusing desktop presentation.
    }
  }
  if (hasNotificationSound(notificationMode)) {
    void playNotificationSound(recovered ? "completion" : "input", () =>
      hasNotificationSound(getClientSettings().notificationMode),
    );
  }
}

function SourcePopover({
  source,
  environmentId,
  environmentLabel,
  onConfigureSources,
}: {
  source: StatusSource;
  environmentId: EnvironmentId;
  environmentLabel: string;
  onConfigureSources: (environmentId: EnvironmentId) => void;
}) {
  const url = toolUrl(source.latest.url);
  const now = useNowMinute();
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${source.config.name}: ${source.latest.state}`}
                />
              }
            />
          }
        >
          <span className="relative inline-flex">
            <StatusSourceIcon source={source} />
            <span className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5">
              <StatusSourceDot state={source.latest.state} />
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {source.config.name} · {source.latest.summary}
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup width="md" align="end">
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <StatusSourceDot state={source.latest.state} />
            <PopoverTitle>{source.config.name}</PopoverTitle>
          </div>
          <p className="break-words">{source.latest.summary}</p>
          <p className="text-xs text-muted-foreground">
            {environmentLabel}
            {source.config.snoozedUntil && source.config.snoozedUntil > now
              ? ` · Snoozed until ${new Date(source.config.snoozedUntil).toLocaleString()}`
              : ""}
          </p>
          {source.lastTransition && (
            <p className="text-xs text-muted-foreground">
              Last transition: {source.lastTransition.from} → {source.lastTransition.to} ·{" "}
              <Tooltip>
                <TooltipTrigger render={<time dateTime={source.lastTransition.at} tabIndex={0} />}>
                  <RelativeTime timestamp={source.lastTransition.at} />
                </TooltipTrigger>
                <TooltipPopup>{new Date(source.lastTransition.at).toLocaleString()}</TooltipPopup>
              </Tooltip>
            </p>
          )}
          {source.latest.items.length > 0 && (
            <ul className="max-h-64 space-y-2 overflow-auto">
              {source.latest.items.map((item) => (
                <li key={item.name} className="flex items-start gap-2">
                  <span className="pt-1.5">
                    <StatusSourceDot state={item.state} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{item.name}</span>
                    {item.detail && (
                      <p className="break-words text-xs text-muted-foreground">{item.detail}</p>
                    )}
                  </div>
                  {toolUrl(item.url) && (
                    <a
                      href={toolUrl(item.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${item.name}`}
                    >
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 text-xs">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Open tool
                <ExternalLinkIcon className="size-3" />
              </a>
            ) : (
              <span />
            )}
            <Button
              variant="ghost-muted"
              size="xs"
              onClick={() => onConfigureSources(environmentId)}
            >
              Manage sources
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function EnvironmentSources({
  environmentId,
  label,
  onConfigureSources,
}: {
  environmentId: EnvironmentId;
  label: string;
  onConfigureSources: (environmentId: EnvironmentId) => void;
}) {
  const query = useEnvironmentQuery(statusSources({ environmentId, input: {} }));
  const [gate] = useState(createStatusSourceNotificationGate);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes external notifications when server-owned source transitions arrive
  useEffect(() => {
    if (query.data)
      for (const source of gate.observe(query.data, Date.now()))
        presentTransition(source, environmentId);
  }, [environmentId, gate, query.data]);
  return query.data?.map((source) => (
    <SourcePopover
      key={source.config.id}
      source={source}
      environmentId={environmentId}
      environmentLabel={label}
      onConfigureSources={onConfigureSources}
    />
  ));
}

export function StatusSourcesStrip({
  onConfigureSources,
}: {
  onConfigureSources: (environmentId: EnvironmentId) => void;
}) {
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  return (
    <div
      className="flex max-w-[min(45vw,24rem)] items-center overflow-x-auto"
      aria-label="External tool status"
    >
      {environments
        .filter(
          (environment) =>
            environment.connection.phase === "connected" &&
            environment.serverConfig?.environment.capabilities.statusSources === true &&
            readable.has(environment.environmentId),
        )
        .map((environment) => (
          <EnvironmentSources
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label}
            onConfigureSources={onConfigureSources}
          />
        ))}
    </div>
  );
}
