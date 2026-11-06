import {
  AuthOrchestrationReadScope,
  RunId,
  type ScopedThreadRef,
  type ThreadInsights,
  type ThreadLoadEvent,
} from "@t3tools/contracts";
import { useState } from "react";
import { SearchIcon, RefreshCwIcon } from "lucide-react";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadInsightsGet } from "../../state/threadInsights";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { filterLoadEvents, reportedUsageTotals } from "./insightDisplay";
import { UsageTimeline } from "./UsageTimeline";

const count = (value: number | null) => (value === null ? "Unknown" : value.toLocaleString());
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const categories = {
  t3: "T3 instructions",
  "app-context": "App context",
  custom: "Custom instructions",
};

export function ThreadInsightsPanel({
  threadRef,
  visible,
  mode,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
  readonly mode: "loads" | "tokens";
}) {
  const [selectedRun, setSelectedRun] = useState<string>("");
  const effectiveSelection = mode === "loads" && selectedRun === "all" ? "" : selectedRun;
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    visible && canRead
      ? threadInsightsGet({
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            ...(effectiveSelection === "all" ? { allRuns: true } : {}),
            ...(effectiveSelection && effectiveSelection !== "all"
              ? { runId: RunId.make(effectiveSelection) }
              : {}),
          },
        })
      : null,
  );
  const data = query.data;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <h2 className="font-semibold">
          {mode === "loads" ? "Files & skills" : "Tokens & context"}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh activity"
          disabled={!canRead || query.isPending}
          onClick={() => query.refresh()}
        >
          <RefreshCwIcon className="size-4" />
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Run
          <select
            aria-label="Inspect run"
            value={effectiveSelection}
            onChange={(event) => setSelectedRun(event.target.value)}
            className="max-w-52 rounded-md border bg-background px-2 py-1 text-foreground"
          >
            <option value="">Latest run</option>
            {mode === "tokens" && <option value="all">All runs</option>}
            {data?.runs.toReversed().map((run) => (
              <option key={run.id} value={run.id}>
                Run {run.ordinal}
                {run.startedAt ? ` · ${date(run.startedAt)}` : ""}
              </option>
            ))}
          </select>
        </label>
      </header>
      {!canRead ? (
        <p className="p-4 text-sm text-muted-foreground">
          This connection cannot read thread activity.
        </p>
      ) : query.error ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {query.error}
        </p>
      ) : !data ? (
        <p className="p-4 text-sm text-muted-foreground">
          {query.isPending ? "Loading activity…" : "No activity available."}
        </p>
      ) : mode === "loads" ? (
        <LoadTimeline events={data.loads} estimateMethod={data.estimateMethod} />
      ) : (
        <TokenDetails data={data} />
      )}
    </div>
  );
}

function LoadTimeline({
  events,
  estimateMethod,
}: {
  readonly events: ReadonlyArray<ThreadLoadEvent>;
  readonly estimateMethod: string;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [evidence, setEvidence] = useState("");
  const filtered = filterLoadEvents(events, search, kind, evidence);
  return (
    <div className="space-y-4 p-4">
      <p className="text-xs text-muted-foreground">
        Observed tool activity, including unsuccessful requests. Inferred shell activity does not
        prove the full file or skill reached the model.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search file and skill activity"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search activity…"
            />
          </InputGroup>
        </div>
        <select
          aria-label="Activity type"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-xs"
        >
          <option value="">All types</option>
          {["file", "skill", "instructions", "search", "resource"].map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          aria-label="Activity evidence"
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-xs"
        >
          <option value="">All evidence</option>
          <option value="reported">Reported</option>
          <option value="inferred">Inferred</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        {filtered.length} of {events.length} events
      </p>
      {filtered.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {["Time", "Type / source", "Path / activity", "Evidence", "Status", "Output"].map(
                  (label) => (
                    <th key={label} className="border-b px-2 py-2 font-medium">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.itemId} className="align-top">
                  <td className="whitespace-nowrap border-b px-2 py-2">{date(event.at)}</td>
                  <td className="border-b px-2 py-2">
                    <span>{event.kind}</span>
                    <div className="mt-1 break-all text-muted-foreground">{event.toolName}</div>
                  </td>
                  <td className="min-w-44 border-b px-2 py-2">
                    <div>{event.label}</div>
                    {event.paths.map((path) => (
                      <code key={path} className="mt-1 block break-all text-muted-foreground">
                        {path}
                      </code>
                    ))}
                  </td>
                  <td className="border-b px-2 py-2">{event.evidence}</td>
                  <td className="border-b px-2 py-2">{event.status}</td>
                  <td className="whitespace-nowrap border-b px-2 py-2">
                    {event.outputBytes === null ? "Unknown" : `${count(event.outputBytes)} B`}
                    {event.estimatedOutputTokens !== null && (
                      <div className="mt-1 text-muted-foreground">
                        ~{count(event.estimatedOutputTokens)} tokens
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-6 text-sm text-muted-foreground">
          {events.length
            ? "No activity matches these filters."
            : "No file or skill activity was identified for this run."}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Output measures tool-result text, not file size or billed input. {estimateMethod}
      </p>
    </div>
  );
}

function TokenDetails({ data }: { readonly data: ThreadInsights }) {
  const usage = data.selectedRunId
    ? data.usage.filter((point) => point.runId === data.selectedRunId)
    : data.usage;
  const footprints = data.selectedRunId
    ? data.footprints.filter((point) => point.runId === data.selectedRunId)
    : data.footprints;
  const totals = reportedUsageTotals(usage);
  return (
    <div className="space-y-6 p-4">
      <section className="space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <h3 className="text-sm font-semibold">Provider-reported usage</h3>
          <span className="text-xs text-muted-foreground">
            {totals.complete ? "Complete" : "Partial / unavailable"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Main input</p>
            <p className="mt-1 text-xl tabular-nums">{count(totals.input)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Main output</p>
            <p className="mt-1 text-xl tabular-nums">{count(totals.output)}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Totals sum reported main-agent values for the selected runs. Local command counters are
          excluded. Missing usage stays unknown. Other input/output covers provider-reported
          subagent or compaction usage separately. Cache and reasoning below are subsets, not
          additional tokens.
        </p>
        <UsageTimeline points={usage.filter((point) => !point.localCommand)} />
        {usage.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  {[
                    "Turn / time",
                    "Input",
                    "Output",
                    "Cache read",
                    "Cache write",
                    "Reasoning",
                    "Other in",
                    "Other out",
                    "Status",
                  ].map((label) => (
                    <th key={label} className="whitespace-nowrap border-b px-2 py-2 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usage.map((point) => (
                  <tr key={point.turnId}>
                    <td className="whitespace-nowrap border-b px-2 py-2">
                      Turn {point.ordinal}
                      <div className="mt-1 text-muted-foreground">{date(point.at)}</div>
                    </td>
                    {Object.entries({
                      input: point.inputTokens,
                      output: point.outputTokens,
                      cached: point.cachedInputTokens,
                      cacheWrite: point.cacheCreationTokens,
                      reasoning: point.reasoningTokens,
                      otherInput: point.otherInputTokens,
                      otherOutput: point.otherOutputTokens,
                    }).map(([key, value]) => (
                      <td key={key} className="border-b px-2 py-2 text-right tabular-nums">
                        {count(value)}
                      </td>
                    ))}
                    <td className="border-b px-2 py-2">
                      {point.localCommand ? "Local command (excluded)" : point.status}
                      {point.hasSubagents && (
                        <div className="mt-1 text-muted-foreground">Subagent activity reported</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No provider usage was recorded for the selected runs.
          </p>
        )}
      </section>
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">Known instruction footprint</h3>
        <p className="text-xs text-muted-foreground">
          Payload estimates captured at dispatch. These describe known instructions, not a breakdown
          of the billed input total. {data.estimateMethod}
        </p>
        {footprints.length ? (
          footprints.map((footprint) => (
            <div
              key={`${footprint.runId}-${footprint.attemptId}-${footprint.providerTurnOrdinal}-${footprint.capturedAt}-${footprint.providerInstanceId}-${footprint.source}`}
              className="space-y-2"
            >
              <p className="text-xs text-muted-foreground">
                {footprint.driver} · {footprint.model} · {date(footprint.capturedAt)}
                <br />
                {footprint.source}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      {["Instruction section", "Type", "Bytes", "Est. tokens"].map((label) => (
                        <th key={label} className="border-b px-2 py-2 font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {footprint.parts.map((part) => (
                      <tr key={part.key}>
                        <td className="border-b px-2 py-2">{part.label}</td>
                        <td className="border-b px-2 py-2 text-muted-foreground">
                          {categories[part.category]}
                        </td>
                        <td className="border-b px-2 py-2 text-right tabular-nums">
                          {count(part.bytes)}
                        </td>
                        <td className="border-b px-2 py-2 text-right tabular-nums">
                          ~{count(part.estimatedTokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">
            No instruction snapshot was captured for this run. Historical payloads cannot be
            reconstructed reliably.
          </p>
        )}
        <div className="rounded-lg border p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Provider harness: unknown</p>
          <p className="mt-1">
            Claude's default harness and other hidden provider instructions are not exposed as an
            exact token breakdown. Unattributed input can also include conversation, tools, files
            and caches. We do not label the remainder as harness tokens.
          </p>
        </div>
      </section>
    </div>
  );
}
