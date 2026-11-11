import { MessageReactionChip } from "./MessageReactionChip";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { type EnvironmentId, type ThreadId, type TurnOrigin } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, SettingsIcon } from "lucide-react";
import { senderCardDetails, messageFirstLine } from "@t3tools/client-runtime/user-message";
import { buildThreadRouteParams } from "../../threadRoutes";
import { resolveThreadGlyph } from "@t3tools/client-runtime/thread-glyphs";
import { useQuietThreadShell } from "../../state/entities";
import { ThreadGlyph } from "../ThreadGlyph";
import { Badge } from "../ui/badge";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { WorkLogRow } from "./WorkLog";
import { TimelineRowTimestamp } from "./TimelineRowParts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { findRevealRef } from "./markdownFindContext";

export function SenderCard(props: {
  readonly origin: Exclude<TurnOrigin, { kind: "user" }>;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly text?: string;
  readonly createdAt?: string;
  readonly timestampFormat?: TimestampFormat;
  readonly queued?: boolean;
  readonly reaction?:
    | import("@t3tools/client-runtime/state/message-reactions").InputMessageReaction
    | undefined;
  readonly children: ReactNode;
}) {
  const sender = "threadId" in props.origin ? props.origin : null;
  const shell = useQuietThreadShell(sender);
  const details = senderCardDetails(props.origin, props.text);
  const glyph = sender ? resolveThreadGlyph(sender.threadId, shell?.glyphSeed) : null;
  const [expanded, setExpanded] = useState(false);
  const revealRef = findRevealRef(() => setExpanded(true));
  const color = glyph
    ? `light-dark(${glyph.lightColor}, ${glyph.color})`
    : "var(--muted-foreground)";
  const style: CSSProperties = {
    borderInlineStartColor: color,
    borderInlineStartWidth: 3,
    backgroundColor: `light-dark(color-mix(in srgb, ${color} 10%, transparent), color-mix(in srgb, ${color} 6%, transparent))`,
  };
  return (
    <WorkLogRow
      role="button"
      tabIndex={0}
      aria-label={`${details.title}: ${messageFirstLine(props.text ?? "")}`}
      aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          setExpanded(!expanded);
        }
      }}
      icon={
        sender ? (
          <ThreadGlyph threadId={sender.threadId} seed={shell?.glyphSeed} className="size-4" />
        ) : (
          <SettingsIcon className="size-4 text-muted-foreground" />
        )
      }
      label={
        <span className="text-muted-foreground">
          {details.title} · {details.summary}
        </span>
      }
      trailing={
        <>
          {props.createdAt ? (
            <TimelineRowTimestamp
              createdAt={props.createdAt}
              timestampFormat={props.timestampFormat ?? "locale"}
              alwaysVisible
            />
          ) : null}
          <MessageReactionChip reaction={props.reaction} />
          <ChevronRightIcon
            aria-hidden
            className={cn("size-3 shrink-0 text-icon-muted", expanded && "rotate-90")}
          />
        </>
      }
    >
      <div
        ref={revealRef}
        hidden={!expanded}
        data-thread-find-text="true"
        data-thread-find-fold={!expanded ? "" : undefined}
        onClick={(event) => event.stopPropagation()}
      >
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
            <MessageReactionChip reaction={props.reaction} />
          </div>
          {details.noReply || props.queued ? (
            <p className="mb-2 text-xs text-muted-foreground">
              {props.queued ? "queued for next turn" : "no reply expected"}
            </p>
          ) : null}
          <div className="wrap-anywhere text-sm">{props.children}</div>
        </section>
      </div>
    </WorkLogRow>
  );
}
