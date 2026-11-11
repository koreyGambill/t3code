import { MessageReactionChip } from "./MessageReactionChip";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { EnvironmentId, ThreadId, type ScopedThreadRef, type TurnOrigin } from "@t3tools/contracts";
import { outgoingT3Message, type OutgoingT3Message } from "@t3tools/client-runtime/t3ToolSummary";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { useTurnItemDetail, type TurnItemDetailSource } from "../../state/queries";
import { turnItemDetailRevision } from "@t3tools/client-runtime/work-log/item-detail";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, SettingsIcon } from "lucide-react";
import { senderCardDetails } from "@t3tools/client-runtime/user-message";
import { buildThreadRouteParams } from "../../threadRoutes";
import { resolveThreadGlyph } from "@t3tools/client-runtime/thread-glyphs";
import { useQuietThreadShell } from "../../state/entities";
import { ThreadGlyph } from "../ThreadGlyph";
import { Badge } from "../ui/badge";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { WorkLogButton, WorkLogRow } from "./WorkLog";
import { TimelineRowTimestamp } from "./TimelineRowParts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { messageFirstLine } from "@t3tools/client-runtime/state/message-reactions";
import * as DateTime from "effect/DateTime";
import type { MessageResponseRow } from "@t3tools/client-runtime/state/message-reactions";
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
  readonly item?: Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }> | undefined;
  readonly detailSource?: TurnItemDetailSource | undefined;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly createdAt?: string;
  readonly timestampFormat?: TimestampFormat;
  readonly reply?: boolean;
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
      text={message.body}
      reply={props.reply}
      error={message.error}
    >
      {(expanded) =>
        expanded && props.item ? (
          <OutgoingMessageBody
            item={props.item}
            message={message}
            environmentId={props.environmentId}
            source={props.detailSource}
          />
        ) : (
          <p className="whitespace-pre-wrap">{message.body}</p>
        )
      }
    </ThreadMessageCard>
  );
}

function OutgoingMessageBody(props: {
  readonly item: Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>;
  readonly message: OutgoingT3Message;
  readonly environmentId: EnvironmentId;
  readonly source: TurnItemDetailSource | undefined;
}) {
  const detail = useTurnItemDetail(
    {
      environmentId: props.environmentId,
      threadId: props.item.threadId,
      itemId: props.item.id,
      revision: turnItemDetailRevision(props.item),
    },
    props.source,
  );
  const item = detail.data?.item;
  const message =
    item?.type === "dynamic_tool"
      ? outgoingT3Message(item.toolName ?? undefined, {
          input: item.input,
          output: item.output,
          outcome: item.status === "failed" ? "failed" : "completed",
        })
      : null;
  return (
    <>
      <p className="whitespace-pre-wrap">{message?.body ?? props.message.body}</p>
      {!message ? (
        <p className="text-xs text-muted-foreground">
          {detail.error ??
            (detail.isPending
              ? "Loading full message…"
              : detail.data
                ? "Full message is no longer available."
                : "")}
        </p>
      ) : null}
    </>
  );
}

function ThreadMessageCard(props: {
  readonly details: ReturnType<typeof senderCardDetails>;
  readonly thread: ScopedThreadRef | null;
  readonly kind: string;
  readonly error?: string | undefined;
  readonly reply?: boolean | undefined;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly text?: string;
  readonly createdAt?: string;
  readonly timestampFormat?: TimestampFormat;
  readonly queued?: boolean;
  readonly reaction?:
    | import("@t3tools/client-runtime/state/message-reactions").InputMessageReaction
    | undefined;
  readonly children: ReactNode | ((expanded: boolean) => ReactNode);
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
      aria-label={`${outgoing ? "To " : ""}${details.title}: ${messageFirstLine(props.text ?? "")}`}
      aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          setExpanded(!expanded);
        }
      }}
      icon={
        outgoing ? (
          <span>{props.reply ? "↳" : "→"}</span>
        ) : sender ? (
          <ThreadGlyph threadId={sender.threadId} seed={shell?.glyphSeed} className="size-4" />
        ) : (
          <SettingsIcon className="size-4 text-muted-foreground" />
        )
      }
      label={
        <span className="text-muted-foreground">
          {outgoing ? "To " : ""}
          {details.title} · {messageFirstLine(props.text ?? "")}
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
          data-sender-card={props.kind}
          className={cn(
            "w-full min-w-0 rounded-lg border border-border px-3 py-2 text-foreground",
            props.queued && "border-dashed",
          )}
          style={style}
        >
          <div className="mb-2 flex min-w-0 items-center gap-2 text-xs">
            {outgoing ? (
              <span className="shrink-0 font-semibold text-muted-foreground">To</span>
            ) : null}
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
          {props.error ? (
            <p className="mb-2 whitespace-pre-wrap wrap-anywhere text-sm text-destructive">
              {props.error}
            </p>
          ) : null}
          <div className="wrap-anywhere text-sm">
            {typeof props.children === "function" ? props.children(expanded) : props.children}
          </div>
        </section>
      </div>
    </WorkLogRow>
  );
}

export function MessageResponseRows(props: {
  readonly rows: ReadonlyArray<MessageResponseRow>;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onScrollToMessage?:
    | ((messageId: import("@t3tools/contracts").MessageId) => void)
    | undefined;
  readonly timestampFormat: TimestampFormat;
  readonly detailSource?: TurnItemDetailSource | undefined;
}) {
  return (
    <div className="ms-7 min-w-0 opacity-80">
      {props.rows.map((row) =>
        row.kind === "reply-line" ? (
          <OutgoingMessageCard
            key={row.item.id}
            message={row.message}
            item={row.item}
            detailSource={props.detailSource}
            environmentId={props.environmentId}
            onOpenThread={props.onOpenThread}
            createdAt={DateTime.formatIso(row.item.startedAt ?? row.item.updatedAt)}
            timestampFormat={props.timestampFormat}
            reply
          />
        ) : (
          <WorkLogButton
            key={row.messageId}
            icon={<span>↳</span>}
            label={`To you · ${messageFirstLine(row.body)}`}
            onClick={() => props.onScrollToMessage?.(row.messageId)}
          />
        ),
      )}
    </div>
  );
}
