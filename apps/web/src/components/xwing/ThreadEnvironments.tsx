import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext } from "react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import {
  AuthOrchestrationReadScope,
  CommandId,
  XwingEnvironmentId,
  type ScopedThreadRef,
  type XwingEnvironmentSummary,
  type OrchestrationV2DevelopmentEnvironmentUsage,
} from "@t3tools/contracts";
import { Boxes, ChevronRightIcon } from "lucide-react";

import { environmentThreadShells } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { randomUUID } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import {
  developmentEnvironmentUsage,
  unlinkThreadEnvironment,
  useXwingEnvironmentsSupport,
  xwingEnvironmentInspect,
  xwingEnvironmentsList,
} from "../../state/xwingEnvironments";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { Empty, EmptyMedia, EmptyDescription } from "../ui/empty";
import { Badge } from "../ui/badge";
import { xwingEnvironmentLabel } from "./xwingEnvironments.logic";

export function useThreadEnvironmentUsage(threadRef: ScopedThreadRef, enabled: boolean) {
  const registry = useContext(RegistryContext);
  const supported = useXwingEnvironmentsSupport(threadRef.environmentId);
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const usage = useEnvironmentQuery(
    enabled && supported && canRead
      ? developmentEnvironmentUsage({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, includeDescendants: true },
        })
      : null,
  );
  const catalog = useEnvironmentQuery(
    enabled && supported && canRead
      ? xwingEnvironmentsList({ environmentId: threadRef.environmentId, input: {} })
      : null,
  );
  const ids = new Set(usage.data?.map((row) => row.xwingEnvironmentId));
  const environments = catalog.data?.filter((environment) => ids.has(environment.id)) ?? [];
  const missing =
    usage.data?.filter(
      (row, index, rows) =>
        !catalog.data?.some((environment) => environment.id === row.xwingEnvironmentId) &&
        rows.findIndex((other) => other.xwingEnvironmentId === row.xwingEnvironmentId) === index,
    ) ?? [];
  return {
    supported,
    canRead,
    usage,
    catalog,
    environments,
    missing,
    refresh: () => {
      usage.refresh();
      catalog.refresh();
      for (const environment of environments)
        registry.refresh(
          xwingEnvironmentInspect({
            environmentId: threadRef.environmentId,
            input: { id: environment.id },
          }),
        );
    },
  };
}

export function ThreadEnvironmentRows({
  threadRef,
  compact = false,
  query = "",
  onSelect,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly compact?: boolean;
  readonly query?: string;
  readonly onSelect: (id: string) => void;
}) {
  const linked = useThreadEnvironmentUsage(threadRef, true);
  const filter = query.toLowerCase().trim();
  const matches = (name: string) => filter === "" || name.toLowerCase().includes(filter);
  if (!linked.supported || !linked.canRead) return null;
  if (linked.usage.error || linked.catalog.error)
    return (
      <p className="p-2 text-xs text-destructive">{linked.usage.error ?? linked.catalog.error}</p>
    );
  if (linked.usage.data === null || linked.catalog.data === null)
    return <p className="p-2 text-xs text-muted-foreground">Loading linked environments…</p>;
  if (linked.usage.data.length === 0)
    return compact ? null : (
      <Empty size="compact">
        <EmptyMedia variant="icon">
          <Boxes />
        </EmptyMedia>
        <EmptyDescription>
          Environments used by this thread and its delegated work appear here.
        </EmptyDescription>
      </Empty>
    );
  const rows = linked.usage.data;
  return (
    <div data-thread-environments-list className="divide-y divide-border/50">
      {linked.environments
        .filter((environment) =>
          matches(
            `${environment.name} ${environment.number ?? ""} ${environment.repositories.map((repo) => `${repo.name} ${repo.branch}`).join(" ")}`,
          ),
        )
        .map((environment) => (
          <ThreadEnvironmentRow
            key={environment.id}
            threadRef={threadRef}
            environment={environment}
            compact={compact}
            onSelect={onSelect}
            usage={rows.filter((row) => row.xwingEnvironmentId === environment.id)}
            onUnlink={linked.usage.refresh}
          />
        ))}
      {linked.missing
        .filter((row) => matches(`${row.name} ${row.number ?? ""}`))
        .map((row) => (
          <div key={row.xwingEnvironmentId}>
            <MissingEnvironmentRow row={row} />
            <UnlinkEnvironment
              threadRef={threadRef}
              usage={rows.filter((entry) => entry.xwingEnvironmentId === row.xwingEnvironmentId)}
              onUnlink={linked.usage.refresh}
            />
          </div>
        ))}
    </div>
  );
}

function ThreadEnvironmentRow({
  threadRef,
  environment,
  compact,
  onSelect,
  usage,
  onUnlink,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly usage: readonly OrchestrationV2DevelopmentEnvironmentUsage[];
  readonly onUnlink: () => void;
  readonly environment: XwingEnvironmentSummary;
  readonly compact: boolean;
  readonly onSelect: (id: string) => void;
}) {
  const detail = useEnvironmentQuery(
    environment.status === "active"
      ? xwingEnvironmentInspect({
          environmentId: threadRef.environmentId,
          input: { id: environment.id },
        })
      : null,
  );
  const running =
    detail.data?.applications.runs.filter(
      (run) => run.status === "running" || run.status === "starting",
    ) ?? [];
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <Boxes className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{xwingEnvironmentLabel(environment)}</span>
        {usage.every((row) => !row.current) ? (
          <Badge size="sm" variant="outline">
            history
          </Badge>
        ) : null}
        {environment.status === "archived" ? (
          <Badge size="sm" variant="secondary">
            archived
          </Badge>
        ) : null}
        <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
      </span>
      <span className="flex flex-col gap-0.5 pl-5 text-muted-foreground">
        {environment.repositories.map((repo) => {
          const inspected = detail.data?.repositories.find(
            (candidate) => candidate.path === repo.path,
          );
          return (
            <span key={repo.path} className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">
                {repo.name} <span className="font-mono">{inspected?.branch ?? repo.branch}</span>
              </span>
              {inspected ? (
                <Badge size="sm" variant={inspected.dirty ? "warning" : "outline"}>
                  {inspected.dirty ? "dirty" : "clean"}
                </Badge>
              ) : null}
            </span>
          );
        })}
        {running.length > 0 ? (
          <span className="truncate">Running: {running.map((run) => run.name).join(", ")}</span>
        ) : null}
        {detail.error ? <span className="text-destructive">{detail.error}</span> : null}
      </span>
    </>
  );
  return (
    <div>
      <Tooltip>
        <TooltipTrigger
          render={
            compact ? (
              <ThreadDetailsControl multiline onClick={() => onSelect(environment.id)} />
            ) : (
              <button
                type="button"
                className="flex w-full min-w-0 flex-col gap-1 px-2 py-2 text-left text-xs hover:bg-accent focus-visible:outline focus-visible:outline-ring"
                onClick={() => onSelect(environment.id)}
              />
            )
          }
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left text-xs">{content}</span>
        </TooltipTrigger>
        <TooltipPopup>{environment.rootPath}</TooltipPopup>
      </Tooltip>
      <div className="flex justify-end px-2 pb-1">
        <UnlinkEnvironment threadRef={threadRef} usage={usage} onUnlink={onUnlink} />
      </div>
    </div>
  );
}

function UnlinkEnvironment({
  threadRef,
  usage,
  onUnlink,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly usage: readonly OrchestrationV2DevelopmentEnvironmentUsage[];
  readonly onUnlink: () => void;
}) {
  const unlink = useAtomCommand(unlinkThreadEnvironment, {
    label: "unlink development environment",
  });
  const allowed = useAtomValue(unlinkThreadEnvironment.permissionAtom(threadRef.environmentId));
  const threads = useAtomValue(
    environmentThreadShells.environmentThreadsAtom(threadRef.environmentId),
  );
  const isCurrentFolder = usage.some((row) =>
    threads.some(
      (thread) => thread.id === row.threadId && thread.worktreePath === row.checkoutPath,
    ),
  );
  if (!allowed || isCurrentFolder) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={async () => {
        for (const row of usage.filter(
          (entry, index, all) =>
            all.findIndex((other) => other.threadId === entry.threadId) === index,
        )) {
          await unlink({
            environmentId: threadRef.environmentId,
            input: {
              commandId: CommandId.make(randomUUID()),
              threadId: row.threadId,
              xwingEnvironmentId: XwingEnvironmentId.make(row.xwingEnvironmentId),
            },
          });
        }
        onUnlink();
      }}
    >
      Unlink
    </Button>
  );
}

function MissingEnvironmentRow({
  row,
}: {
  readonly row: OrchestrationV2DevelopmentEnvironmentUsage;
}) {
  return (
    <div className="px-2 py-1.5 text-xs text-muted-foreground">
      {xwingEnvironmentLabel({ name: row.name, number: row.number ?? undefined })} · no longer
      available
      <span className="block break-all font-mono">{row.checkoutPath}</span>
    </div>
  );
}
