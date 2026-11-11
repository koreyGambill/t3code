import { MessageReactionChip } from "./MessageReactionChip";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { EnvironmentId, ThreadId, type ScopedThreadRef, type TurnOrigin } from "@t3tools/contracts";
import type { OutgoingT3Message } from "@t3tools/client-runtime/t3ToolSummary";
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
import { observeResize } from "../../lib/observeResize";
import { findRevealRef } from "./markdownFindContext";

export function SenderCard(props: {
  readonly origin: Exclude<TurnOrigin, { kind: "user" }>;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly queued?: boolean;
  readonly reaction?:
    | import("@t3tools/client-runtime/state/message-reactions").InputMessageReaction
    | undefined;
  readonly children: ReactNode;
}) {
  return (
    <ThreadMessageCard
      {...props}
      details={senderCardDetails(props.origin)}
      thread={"threadId" in props.origin ? props.origin : null}
      kind={props.origin.kind}
    />
  );
}

export function OutgoingMessageCard(props: {
  readonly message: OutgoingT3Message;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { message } = props;
  const thread = message.threadId
    ? {
        threadId: ThreadId.make(message.threadId),
        environmentId: message.environmentId
          ? EnvironmentId.make(message.environmentId)
          : props.environmentId,
      }
    : null;
  return (
    <ThreadMessageCard
      {...props}
      thread={thread}
      details={{ ...message, title: message.threadId ?? "Thread unavailable" }}
      kind="outgoing"
      error={message.error}
    >
      <p className="whitespace-pre-wrap">{message.body}</p>
    </ThreadMessageCard>
  );
}

function ThreadMessageCard(props: {
  readonly details: ReturnType<typeof senderCardDetails>;
  readonly thread: ScopedThreadRef | null;
  readonly kind: string;
  readonly error?: string | undefined;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly queued?: boolean;
  readonly reaction?:
    | import("@t3tools/client-runtime/state/message-reactions").InputMessageReaction
    | undefined;
  readonly children: ReactNode;
}) {
  const sender = props.thread;
  const shell = useQuietThreadShell(sender);
  const outgoing = props.kind === "outgoing";
  const details = {
    ...props.details,
    title: outgoing ? shell?.title || props.details.title : props.details.title,
  };
  const glyph = sender ? resolveThreadGlyph(sender.threadId, shell?.glyphSeed) : null;
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const revealRef = findRevealRef(() => setExpanded(true));
  const contentRef = (content: HTMLDivElement | null) => {
    const clip = content?.parentElement;
    if (!content || !clip) return;
    // The clip is height-capped, so only the unclipped content reports growth.
    const measure = () => {
      if (!expanded) setOverflowing(content.offsetHeight > clip.clientHeight + 1);
    };
    measure();
    return observeResize(content, measure);
  };
  const folded = !expanded && overflowing;
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
      data-sender-card={props.kind}
      className={cn(
        "w-full min-w-0 rounded-lg border border-border px-3 py-2 text-foreground",
        props.queued && "border-dashed",
      )}
      style={style}
    >
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs">
        {outgoing ? <span className="shrink-0 font-semibold text-muted-foreground">To</span> : null}
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
        {overflowing ? (
          <Button
            className="ms-auto shrink-0"
            size="xs"
            variant="ghost-muted"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        ) : null}
      </div>
      {details.noReply || props.queued ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {props.queued ? "queued for next turn" : "no reply expected"}
        </p>
      ) : null}
      {props.error ? (
        <p className="mb-2 whitespace-pre-wrap wrap-anywhere text-sm text-destructive">
          {props.error}
        </p>
      ) : null}
      <div
        ref={revealRef}
        data-thread-find-text="true"
        data-thread-find-fold={folded ? "" : undefined}
        className={cn(
          "wrap-anywhere text-sm",
          !expanded && "max-h-10 overflow-hidden",
          folded && "[mask-image:linear-gradient(to_bottom,black_calc(100%-0.75rem),transparent)]",
        )}
      >
        <div ref={contentRef}>{props.children}</div>
      </div>
    </section>
  );
}
