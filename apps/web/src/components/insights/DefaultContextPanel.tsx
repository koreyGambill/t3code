import {
  AuthOrchestrationReadScope,
  type DefaultContextItem,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { CheckIcon, ChevronRightIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadDefaultContextGet, threadDefaultContextItem } from "../../state/threadInsights";
import { Button } from "../ui/button";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  defaultContextSummary,
  DELIVERY_LABELS,
  formatBytes,
  formatTokens,
  homeOf,
  shortenPath,
  STATUS_LABELS,
  TOOL_PREVIEW_COUNT,
} from "./defaultContext.logic";

const CATEGORY_COLORS: Record<DefaultContextItem["category"], string> = {
  t3: "bg-primary",
  files: "bg-success",
  tools: "bg-info",
  "app-context": "bg-warning",
  custom: "bg-muted-foreground",
};
const STATUS_MARKS: Partial<Record<NonNullable<DefaultContextItem["status"]>, string>> = {
  loaded: "✓",
  "not-loaded": "!",
  unexpected: "+",
  changed: "Δ",
  "outside-home": "⊘",
  secret: "⊘",
};

export function DefaultContextPanel({
  threadRef,
  visible,
  tabs,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
  readonly tabs: ReactNode;
}) {
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    visible && canRead
      ? threadDefaultContextGet({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const [showAllTools, setShowAllTools] = useState(false);
  const preview = query.data;
  const summary = preview == null ? null : defaultContextSummary(preview);
  const provider =
    preview == null || preview.driver === ""
      ? "this provider"
      : (PROVIDER_DISPLAY_NAMES[ProviderDriverKind.make(preview.driver)] ?? preview.driver);
  const home =
    preview == null
      ? null
      : homeOf([...(preview.cwd ? [preview.cwd] : []), ...preview.items.map((item) => item.label)]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
      <header className="flex min-h-7 shrink-0 items-center border-b px-1 py-0.5">{tabs}</header>
      <div className="min-w-0 space-y-3 p-2 text-xs">
        {!canRead ? (
          <p>Context access is unavailable.</p>
        ) : query.error ? (
          <p role="alert">Could not load the default context.</p>
        ) : preview == null || summary === null ? (
          <p className="text-muted-foreground">Loading default context…</p>
        ) : (
          <>
            <section aria-label="Default context total" className="space-y-1.5">
              <p className="text-muted-foreground">
                What loads before your message for {provider}
                {preview.model ? ` · ${preview.model}` : ""}
              </p>
              <div className="flex items-center gap-1">
                <p className="min-w-0 flex-1 text-sm font-medium tabular-nums">
                  ~{formatTokens(summary.tokens)} tokens
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {formatBytes(summary.bytes)}
                    {preview.support === "estimate" ? " · estimate" : ""}
                  </span>
                </p>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Refresh default context"
                        onClick={() => query.refresh()}
                      />
                    }
                  >
                    <RefreshCwIcon />
                  </TooltipTrigger>
                  <TooltipPopup>Refresh default context</TooltipPopup>
                </Tooltip>
              </div>
              <div className="flex h-2 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
                {summary.categories.map((category) => (
                  <div
                    key={category.category}
                    className={CATEGORY_COLORS[category.category]}
                    style={{ width: `${category.share * 100}%` }}
                  />
                ))}
              </div>
              <ul className="space-y-0.5 tabular-nums">
                {summary.categories.map((category) => (
                  <li key={category.category} className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-xs",
                        CATEGORY_COLORS[category.category],
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{category.label}</span>
                    <span>{formatTokens(category.tokens)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <p className="text-muted-foreground">
              {preview.lastTurn === null
                ? "No turn captured yet; everything here is expected."
                : `Compared with the turn at ${new Date(preview.lastTurn.capturedAt).toLocaleString()}${summary.attention > 0 ? ` · ${summary.attention} ${summary.attention === 1 ? "difference" : "differences"}` : ""}.`}
              {preview.lastTurn !== null && !preview.lastTurn.reportsFiles && preview.filesSupported
                ? ` ${provider} doesn't report which instruction files it loaded.`
                : ""}
            </p>
            {preview.support === "unsupported" && (
              <p role="status">Default context isn't supported for {provider}.</p>
            )}
            {preview.support !== "unsupported" && !preview.filesSupported && (
              <p className="text-muted-foreground">
                Instruction files aren't supported for {provider}: it documents no convention.
              </p>
            )}
            {preview.notes.map((note) => (
              <p key={note} className="text-muted-foreground">
                {note}
              </p>
            ))}
            {summary.groups.map((group) => {
              const items =
                group.category === "tools" && !showAllTools
                  ? group.items.slice(0, TOOL_PREVIEW_COUNT)
                  : group.items;
              return (
                <section key={group.category} aria-label={group.label} className="space-y-0.5">
                  <h3 className="text-3xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.label}
                  </h3>
                  {items.map((item) => (
                    <ContextRow
                      key={item.id}
                      threadRef={threadRef}
                      item={item}
                      label={
                        group.category === "files" ? shortenPath(item.label, home) : item.label
                      }
                    />
                  ))}
                  {items.length < group.items.length && (
                    <Button variant="ghost" size="xs" onClick={() => setShowAllTools(true)}>
                      Show all {group.items.length}
                    </Button>
                  )}
                </section>
              );
            })}
            {preview.notVisible.length > 0 && (
              <section aria-label="Not visible to T3" className="space-y-1 text-muted-foreground">
                <h3 className="text-3xs font-semibold tracking-wide uppercase">
                  Not visible to T3
                </h3>
                <ul className="space-y-1">
                  {preview.notVisible.map((entry) => (
                    <li key={entry.label}>
                      <span className="text-foreground">{entry.label}.</span> {entry.why}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-muted-foreground">{preview.estimateMethod}</p>
          </>
        )}
      </div>
    </div>
  );
}

function ContextRow({
  threadRef,
  item,
  label,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly item: DefaultContextItem;
  readonly label: string;
}) {
  const [open, setOpen] = useState(false);
  const status = item.status === undefined ? undefined : STATUS_LABELS[item.status];
  const mark = item.status === undefined ? undefined : STATUS_MARKS[item.status];
  return (
    <div style={item.depth ? { paddingLeft: `${item.depth * 8}px` } : undefined}>
      <button
        type="button"
        aria-expanded={open}
        disabled={!item.readable}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full min-w-0 items-center gap-1 rounded px-0.5 py-0.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:hover:bg-transparent",
          !item.counted && "text-muted-foreground",
        )}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground",
            open && "rotate-90",
            !item.readable && "invisible",
          )}
        />
        {item.category === "files" ? (
          <MiddleTruncate value={label} showTitle={false} className="min-w-0 flex-1" />
        ) : (
          <span className="min-w-0 flex-1 truncate">{label}</span>
        )}
        {mark !== undefined && (
          <span
            role="img"
            aria-label={status}
            className={cn(
              "shrink-0",
              item.status === "loaded" ? "text-success-foreground" : "text-warning-foreground",
            )}
          >
            {mark}
          </span>
        )}
        <span className="shrink-0 tabular-nums">{formatTokens(item.estimatedTokens)}</span>
      </button>
      {!item.readable && status !== undefined && (
        <p className="ml-4 text-muted-foreground">{status}</p>
      )}
      {open && <ItemText threadRef={threadRef} item={item} status={status} />}
    </div>
  );
}

function ItemText({
  threadRef,
  item,
  status,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly item: DefaultContextItem;
  readonly status: string | undefined;
}) {
  const query = useEnvironmentQuery(
    threadDefaultContextItem({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, itemId: item.id },
    }),
  );
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500, target: "text" });
  return (
    <div className="ml-4 space-y-1 py-1">
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="min-w-0 flex-1">
          {item.category === "files" && <span className="block break-all">{item.label}</span>}
          {item.source} · {DELIVERY_LABELS[item.delivery]} · {formatBytes(item.bytes)}
          {status === undefined ? "" : ` · ${status}`}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Copy text"
          disabled={query.data == null}
          onClick={() => query.data && copyToClipboard(query.data.text, undefined)}
        >
          {isCopied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      {query.error ? (
        <p role="alert">Could not load this text.</p>
      ) : query.data == null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <pre className="max-h-60 overflow-auto rounded border bg-muted/40 p-1.5 font-mono text-3xs leading-4 whitespace-pre-wrap break-words">
          {query.data.text}
          {query.data.truncated ? "\n… truncated" : ""}
        </pre>
      )}
    </div>
  );
}
