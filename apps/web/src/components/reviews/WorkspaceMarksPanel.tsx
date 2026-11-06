import { useState } from "react";
import { Columns3Icon, CopyIcon, SearchIcon, CheckIcon, RefreshCwIcon } from "lucide-react";
import type { ScopedThreadRef, WorkspaceMarkAnnotation } from "@t3tools/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "../../state/query";
import { threadMarksGet } from "../../state/threadMarks";
import type { WorkspaceMark } from "@t3tools/shared/workspaceMarks";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Popover, PopoverTrigger, PopoverPopup } from "../ui/popover";
import { markTimestamp } from "./workspaceMarks";

const useMarkPreferences = create(
  persist<{
    local: boolean;
    utc: boolean;
    service: boolean;
    description: boolean;
    hour24: boolean;
    toggle: (key: "local" | "utc" | "service" | "description" | "hour24") => void;
  }>(
    (set) => ({
      local: true,
      utc: true,
      service: true,
      description: false,
      hour24: false,
      toggle: (key) => set((state) => ({ [key]: !state[key] })),
    }),
    { name: "t3-workspace-mark-columns" },
  ),
);

export function WorkspaceMarksPanel({
  threadRef,
  annotations,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly annotations: ReadonlyArray<WorkspaceMarkAnnotation>;
}) {
  const query = useEnvironmentQuery(
    threadMarksGet({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const marks = query.data ?? [];
  const preferences = useMarkPreferences();
  const [search, setSearch] = useState("");
  const [service, setService] = useState("all");
  const [sort, setSort] = useState<keyof WorkspaceMark>("timestamp");
  const [ascending, setAscending] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const annotatedMarks = marks.map((mark) => ({
    ...mark,
    description: annotations.find((annotation) => annotation.url === mark.url)?.description ?? "",
  }));
  const rows = annotatedMarks
    .filter(
      (mark) =>
        (service === "all" || mark.service === service) &&
        [
          mark.url,
          mark.service,
          mark.description,
          markTimestamp(mark.timestamp, false, preferences.hour24),
          markTimestamp(mark.timestamp, true, preferences.hour24),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .toSorted((a, b) => a[sort].localeCompare(b[sort]) * (ascending ? 1 : -1));
  const [copyError, setCopyError] = useState<string | null>(null);
  const { copyToClipboard: copy, isCopied } = useCopyToClipboard<string>({
    target: "workspace marks",
    onCopy: setCopied,
    onError: (error) => setCopyError(error.message),
  });
  const sortBy = (field: keyof WorkspaceMark) => {
    setAscending(field === sort ? !ascending : true);
    setSort(field);
  };
  const heading = (field: keyof WorkspaceMark, label: string) => (
    <th className="whitespace-nowrap px-2 py-2 text-left font-medium">
      <button onClick={() => sortBy(field)}>
        {label}
        {field === sort ? (ascending ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Marks</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh Marks"
          disabled={query.isPending}
          onClick={query.refresh}
        >
          <RefreshCwIcon className="size-4" />
        </Button>
      </div>
      {query.error && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {query.error}
        </p>
      )}
      {copyError ? (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {copyError}
        </p>
      ) : null}
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search all Marks columns"
              placeholder="Search…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </InputGroup>
        </div>
        <Popover>
          <PopoverTrigger
            render={
              <Button size="icon-sm" variant="ghost" aria-label="Marks columns and filters">
                <Columns3Icon className="size-4" />
              </Button>
            }
          />
          <PopoverPopup side="top" align="end" className="w-52">
            <div className="space-y-3 p-3">
              {(
                [
                  ["local", "Local time"],
                  ["utc", "UTC"],
                  ["service", "Service"],
                  ["description", "Description"],
                  ["hour24", "24-hour clock"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={preferences[key]}
                    onChange={() => preferences.toggle(key)}
                  />
                  {label}
                </label>
              ))}
              <label className="flex items-center justify-between gap-2 text-xs">
                Service
                <select
                  aria-label="Filter Marks service"
                  value={service}
                  onChange={(event) => setService(event.target.value)}
                  className="rounded border border-border bg-background p-1"
                >
                  <option value="all">All</option>
                  {[...new Set(marks.map((mark) => mark.service))].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>
          </PopoverPopup>
        </Popover>
        <Button
          size="xs"
          variant="outline"
          disabled={!rows.length}
          onClick={() => {
            void copy(
              rows
                .map((mark) =>
                  [
                    preferences.local
                      ? markTimestamp(mark.timestamp, false, preferences.hour24)
                      : "",
                    preferences.utc ? markTimestamp(mark.timestamp, true, preferences.hour24) : "",
                    preferences.service ? mark.service : "",
                    mark.url,
                    preferences.description ? mark.description : "",
                  ]
                    .filter(Boolean)
                    .join(" "),
                )
                .join("\n"),
              "all",
            );
          }}
        >
          {isCopied && copied === "all" ? "Copied" : "Copy all"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background text-muted-foreground">
            <tr>
              {preferences.local ? heading("timestamp", "Local time") : null}
              {preferences.utc ? heading("timestamp", "UTC") : null}
              {preferences.service ? heading("service", "Service") : null}
              {heading("url", "Link")}
              {preferences.description ? heading("description", "Description") : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((mark) => (
              <tr key={mark.url} className="border-b border-border/50">
                {preferences.local ? (
                  <td className="whitespace-nowrap px-2 py-2 text-3xs text-muted-foreground">
                    {markTimestamp(mark.timestamp, false, preferences.hour24)}
                  </td>
                ) : null}
                {preferences.utc ? (
                  <td className="whitespace-nowrap px-2 py-2 text-3xs text-muted-foreground">
                    {markTimestamp(mark.timestamp, true, preferences.hour24)}
                  </td>
                ) : null}
                {preferences.service ? <td className="px-2 py-2">{mark.service}</td> : null}
                <td className="max-w-64 truncate px-2 py-2">
                  <a
                    href={mark.url}

                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {mark.url}
                  </a>
                </td>
                {preferences.description ? <td className="px-2 py-2">{mark.description}</td> : null}
                <td>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Copy ${mark.url}`}
                    onClick={() => {
                      void copy(mark.url, mark.url);
                    }}
                  >
                    {isCopied && copied === mark.url ? (
                      <CheckIcon className="size-3" />
                    ) : (
                      <CopyIcon className="size-3" />
                    )}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <p className="p-5 text-sm text-muted-foreground">
            {query.isPending
              ? "Loading links…"
              : "Links from this conversation appear here automatically."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
