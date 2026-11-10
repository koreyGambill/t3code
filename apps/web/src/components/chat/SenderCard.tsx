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
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
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
    backgroundColor: `light-dark(color-mix(in srgb, ${color} 10%, transparent), color-mix(in srgb, ${color} 6%, transparent))`,
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
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs">
        {sender ? (
          <ThreadGlyph
            threadId={sender.threadId}
            seed={shell?.glyphSeed}
            className="size-4 shrink-0"
          />
        ) : (
          <SettingsIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate font-semibold" style={{ color }}>
          <Tooltip>
            <TooltipTrigger
              render={
                sender ? (
                  <InlineButton
                    className="max-w-full"
                    role="link"
                    tone="inherit"
                    render={
                      sender.environmentId === props.environmentId ? undefined : (
                        <Link
                          to="/$environmentId/$threadId"
                          params={buildThreadRouteParams(sender)}
                        />
                      )
                    }
                    onClick={
                      sender.environmentId === props.environmentId
                        ? () => props.onOpenThread(sender.threadId)
                        : undefined
                    }
                  >
                    <span className="truncate">{details.title}</span>
                  </InlineButton>
                ) : (
                  <span>{details.title}</span>
                )
              }
            />
            <TooltipPopup>{details.title}</TooltipPopup>
          </Tooltip>
        </span>
        <span className="shrink-0 text-muted-foreground">{details.relationship}</span>
        <Badge variant={details.event === "failed" ? "error-outline" : "outline"}>
          {details.event}
        </Badge>
      </div>
      {details.noReply || props.queued ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {props.queued ? "queued for next turn" : "no reply expected"}
        </p>
      ) : null}
      <div
        ref={revealRef}
        data-thread-find-text="true"
        data-thread-find-fold={collapsed ? "" : undefined}
        className={cn(
          "wrap-anywhere text-sm",
          collapsed &&
            "max-h-44 overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]",
        )}
      >
        {props.children}
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
