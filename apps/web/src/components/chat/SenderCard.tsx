import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import type { EnvironmentId, ThreadId, TurnOrigin } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";
import { senderCardDetails } from "@t3tools/client-runtime/user-message";
import { buildThreadRouteParams } from "../../threadRoutes";
import { resolveThreadGlyph } from "@t3tools/client-runtime/thread-glyphs";
import { useQuietThreadShell } from "../../state/entities";
import { ThreadGlyph } from "../ThreadGlyph";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { cn } from "../../lib/utils";
import { findRevealRef } from "./markdownFindContext";

export function SenderCard(props: {
  readonly origin: Exclude<TurnOrigin, { kind: "user" }>;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly text: string;
  readonly queued?: boolean;
  readonly children: ReactNode;
}) {
  const details = senderCardDetails(props.origin);
  const sender = "threadId" in props.origin ? props.origin : null;
  const shell = useQuietThreadShell(sender);
  const glyph = sender ? resolveThreadGlyph(sender.threadId, shell?.glyphSeed) : null;
  const [expanded, setExpanded] = useState(false);
  const revealRef = findRevealRef(() => setExpanded(true));
  const long = props.text.length > 600 || props.text.split("\n").length > 6;
  const collapsed = long && !expanded;
  const color = glyph
    ? `light-dark(${glyph.lightColor}, ${glyph.color})`
    : "var(--muted-foreground)";
  const style: CSSProperties = {
    borderInlineStartColor: color,
    borderInlineStartWidth: 3,
    backgroundColor: `color-mix(in srgb, ${color} 6%, transparent)`,
  };
  return (
    <section
      aria-label={`${details.title} · ${details.relationship}`}
      data-sender-card={props.origin.kind}
      className={cn(
        "w-full min-w-0 rounded-lg border border-border px-3 py-2 text-foreground",
        props.queued && "border-dashed",
      )}
      style={style}
    >
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {sender ? (
          <ThreadGlyph threadId={sender.threadId} seed={shell?.glyphSeed} className="size-4" />
        ) : (
          <SettingsIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span
          className="min-w-0 break-words font-semibold [--inline-button-white-space:normal] [--inline-button-text-align:start]"
          style={{ color }}
        >
          {sender ? (
            <InlineButton
              role="link"
              tone="inherit"
              render={
                sender.environmentId === props.environmentId ? undefined : (
                  <Link to="/$environmentId/$threadId" params={buildThreadRouteParams(sender)} />
                )
              }
              onClick={
                sender.environmentId === props.environmentId
                  ? () => props.onOpenThread(sender.threadId)
                  : undefined
              }
            >
              {details.title}
            </InlineButton>
          ) : (
            details.title
          )}
        </span>
        <span className="text-muted-foreground">· {details.relationship}</span>
        <Badge variant="outline">{details.event}</Badge>
        {details.noReply ? <span className="text-muted-foreground">no reply expected</span> : null}
        {props.queued ? <span className="text-muted-foreground">queued for next turn</span> : null}
      </div>
      <div
        ref={revealRef}
        data-thread-find-text="true"
        data-thread-find-fold={collapsed ? "" : undefined}
        className={cn("wrap-anywhere", collapsed && "max-h-36 overflow-hidden")}
      >
        {collapsed ? <p className="whitespace-pre-wrap">{props.text}</p> : props.children}
      </div>
      {long ? (
        <div className="mt-1 flex justify-end">
          <Button
            size="xs"
            variant="ghost-muted"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show less" : "Show full message"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
