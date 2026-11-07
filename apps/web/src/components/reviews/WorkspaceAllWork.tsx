import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ThreadWorkspaceWorkEntry,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { threadWorkspaceListWork, threadWorkspacePatch } from "../../state/threadWorkspace";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { WorkRow } from "./WorkspaceRecordViews";

export function WorkspaceAllWork() {
  const { environments } = useEnvironments();
  const [filter, setFilter] = useState("pending");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
        Human QA
        <select
          aria-label="Human QA filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="rounded border border-input bg-background px-1"
        >
          <option value="all">All work</option>
          <option value="pending">Pending</option>
          <option value="passed">Passed</option>
          <option value="issues">Issues</option>
        </select>
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {environments.map((environment) => (
          <EnvironmentWork
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label}
            connected={environment.connection.phase === "connected"}
            filter={filter}
          />
        ))}
      </div>
    </div>
  );
}

function EnvironmentWork({
  environmentId,
  label,
  connected,
  filter,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly filter: string;
}) {
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    connected && canRead
      ? threadWorkspaceListWork({
          environmentId,
          input:
            filter === "pending" || filter === "passed" || filter === "issues"
              ? { userQa: [filter] }
              : {},
        })
      : null,
  );
  const rows = query.data;
  return (
    <section>
      <h4 className="border-b border-border bg-muted/30 px-2 py-1 text-xs font-medium">{label}</h4>
      {!connected || !canRead ? (
        <p className="p-2 text-xs text-muted-foreground">
          {!connected ? "Machine disconnected." : "This connection cannot read agent work."}
        </p>
      ) : query.error ? (
        <p role="alert" className="p-2 text-xs text-destructive">
          {query.error}
        </p>
      ) : !rows ? (
        <p className="p-2 text-xs text-muted-foreground">Loading agent work…</p>
      ) : rows.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">No work matches this QA status.</p>
      ) : (
        <ul aria-label={`Agent work on ${label}`}>
          {rows.map((entry) => (
            <AggregateWorkRow
              key={`${entry.threadId}:${entry.item.id}:${entry.item.userQaNote}`}
              environmentId={environmentId}
              entry={entry}
              refresh={query.refresh}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AggregateWorkRow({
  environmentId,
  entry,
  refresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: ThreadWorkspaceWorkEntry;
  readonly refresh: () => void;
}) {
  const canWrite = useAtomValue(threadWorkspacePatch.permissionAtom(environmentId));
  const patch = useAtomCommand(threadWorkspacePatch, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li>
      <div className="flex items-center px-2 pt-1">
        <Button
          size="xs"
          variant="link"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams({ environmentId, threadId: entry.threadId })}
            />
          }
        >
          {entry.threadTitle}
        </Button>
        {error ? (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        ) : null}
      </div>
      <ul>
        <WorkRow
          item={entry.item}
          verifications={entry.verifications}
          disabled={!canWrite || busy}
          apply={(changes) => {
            setBusy(true);
            setError(null);
            void patch({
              environmentId,
              input: { threadId: entry.threadId, expectedRevision: entry.revision, changes },
            }).then((result) => {
              if (result._tag !== "Success") {
                const cause = squashAtomCommandFailure(result);
                setError(cause instanceof Error ? cause.message : "Could not update agent work.");
              }
              refresh();
              setBusy(false);
            });
          }}
        />
      </ul>
    </li>
  );
}
