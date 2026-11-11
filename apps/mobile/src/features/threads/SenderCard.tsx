import { MessageReactionChip } from "./MessageReactionChip";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { EnvironmentId, ThreadId, type ScopedThreadRef, type TurnOrigin } from "@t3tools/contracts";
import type { OutgoingT3Message } from "@t3tools/client-runtime/t3ToolSummary";
import { senderCardDetails } from "@t3tools/client-runtime/user-message";
import { resolveThreadGlyph } from "@t3tools/client-runtime/thread-glyphs";
import { AppText as Text } from "../../components/ui/AppText";
import { Chip } from "../../components/ui/Chip";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useQuietThreadShell } from "../../state/entities";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

import * as DateTime from "effect/DateTime";
import type { MessageResponseRow } from "@t3tools/client-runtime/state/message-reactions";
import { messageFirstLine } from "@t3tools/client-runtime/state/message-reactions";

export function SenderCard(props: {
  readonly origin: Exclude<TurnOrigin, { kind: "user" }>;
  readonly text: string;
  readonly createdAt?: string;
  readonly queued?: boolean;
  readonly reaction?:
    | import("@t3tools/client-runtime/state/message-reactions").InputMessageReaction
    | undefined;
  readonly children?: ReactNode;
}) {
  return (
    <ThreadMessageCard
      {...props}
      details={senderCardDetails(props.origin)}
      thread={"threadId" in props.origin ? props.origin : null}
    />
  );
}

export function OutgoingMessageCard(props: {
  readonly message: OutgoingT3Message;
  readonly environmentId: EnvironmentId;
  readonly createdAt?: string;
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
      thread={thread}
      details={{ ...message, title: message.threadId ?? "Thread unavailable" }}
      text={message.body}
      outgoing
      createdAt={props.createdAt}
      reply={props.reply}
      error={message.error}
    />
  );
}

function ThreadMessageCard(props: {
  readonly details: ReturnType<typeof senderCardDetails>;
  readonly thread: ScopedThreadRef | null;
  readonly text: string;
  readonly outgoing?: boolean;
  readonly reply?: boolean;
  readonly error?: string | undefined;
  readonly createdAt?: string;
  readonly queued?: boolean;
  readonly reaction?:
    | import("@t3tools/client-runtime/state/message-reactions").InputMessageReaction
    | undefined;
  readonly children?: ReactNode;
}) {
  const sender = props.thread;
  const shell = useQuietThreadShell(sender);
  const details = {
    ...props.details,
    title: props.outgoing ? shell?.title || props.details.title : props.details.title,
  };
  const glyph = sender ? resolveThreadGlyph(sender.threadId, shell?.glyphSeed) : null;
  const { themeAppearance } = useAppearancePreferences();
  const color = glyph ? (themeAppearance === "dark" ? glyph.color : glyph.lightColor) : undefined;
  const openThread = useOpenLinkedThread();
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="min-w-0">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.outgoing ? "To " : ""}${details.title}: ${messageFirstLine(props.text)}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        className="min-h-8 min-w-0 flex-row items-center gap-1.5 py-0.5"
      >
        <View className="w-6 shrink-0 items-center">
          {props.outgoing ? (
            <Text className="text-sm text-foreground-muted">{props.reply ? "↳" : "→"}</Text>
          ) : glyph ? (
            <Svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke={color}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {glyph.paths.map((path) => (
                <Path key={path} d={path} />
              ))}
            </Svg>
          ) : (
            <SymbolView name="gearshape" size={16} tintColorClassName="accent-foreground-muted" />
          )}
        </View>
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground-muted">
          {props.outgoing ? "To " : ""}
          {details.title} · {messageFirstLine(props.text)}
        </Text>
        {props.createdAt ? (
          <Text className="shrink-0 text-xs tabular-nums text-foreground-muted">
            {new Date(props.createdAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        ) : null}
        <MessageReactionChip reaction={props.reaction} />
        <SymbolView
          name={expanded ? "chevron.down" : "chevron.right"}
          size={12}
          tintColorClassName="accent-foreground-muted"
        />
      </Pressable>
      {expanded ? (
        <View
          className="w-full overflow-hidden rounded-lg border border-border border-l-foreground-muted bg-subtle px-3 py-2"
          style={{
            borderLeftWidth: 3,
            borderLeftColor: color,
            borderStyle: props.queued ? "dashed" : "solid",
          }}
        >
          {glyph ? (
            <View
              pointerEvents="none"
              className="absolute inset-0"
              style={{ backgroundColor: color, opacity: themeAppearance === "dark" ? 0.06 : 0.1 }}
            />
          ) : null}
          <View className="mb-2 flex-row items-center gap-2">
            {props.outgoing ? (
              <Text className="shrink-0 font-t3-bold text-xs text-foreground-muted">To</Text>
            ) : null}
            <View className="shrink-0">
              {glyph ? (
                <Svg
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={color}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {glyph.paths.map((path) => (
                    <Path key={path} d={path} />
                  ))}
                </Svg>
              ) : (
                <SymbolView
                  name="gearshape"
                  size={16}
                  tintColorClassName="accent-foreground-muted"
                />
              )}
            </View>
            {sender ? (
              <Pressable
                className="min-w-0 shrink"
                accessibilityRole="link"
                accessibilityLabel={details.title}
                onPress={() => openThread(sender)}
              >
                <Text
                  numberOfLines={1}
                  className="min-w-0 shrink font-t3-bold text-sm text-foreground-muted"
                  style={{ color }}
                >
                  {details.title}
                </Text>
              </Pressable>
            ) : (
              <Text
                numberOfLines={1}
                className="min-w-0 shrink font-t3-bold text-sm text-foreground-muted"
                style={{ color }}
              >
                {details.title}
              </Text>
            )}
            <Text className="shrink-0 text-xs text-foreground-muted">{details.relationship}</Text>
            <MessageReactionChip reaction={props.reaction} />
            <View className="shrink-0">
              <Chip
                label={details.event}
                size="small"
                tone={details.event === "failed" ? "error" : "neutral"}
              />
            </View>
          </View>
          {details.noReply || props.queued ? (
            <Text className="mb-2 text-xs text-foreground-muted">
              {props.queued ? "queued for next turn" : "no reply expected"}
            </Text>
          ) : null}
          {props.error ? (
            <Text className="mb-2 text-sm text-danger-foreground">{props.error}</Text>
          ) : null}
          {props.children ?? <Text className="text-sm text-foreground">{props.text}</Text>}
        </View>
      ) : null}
    </View>
  );
}

export function MessageResponseRows(props: {
  readonly rows: ReadonlyArray<MessageResponseRow>;
  readonly environmentId: EnvironmentId;
  readonly onScrollToMessage: (messageId: import("@t3tools/contracts").MessageId) => void;
}) {
  return (
    <View className="ml-7 min-w-0 opacity-80">
      {props.rows.map((row) =>
        row.kind === "reply-line" ? (
          <OutgoingMessageCard
            key={row.item.id}
            message={row.message}
            environmentId={props.environmentId}
            createdAt={DateTime.formatIso(row.item.startedAt ?? row.item.updatedAt)}
            reply
          />
        ) : (
          <Pressable
            key={row.messageId}
            accessibilityRole="button"
            accessibilityLabel={`To you: ${messageFirstLine(row.body)}`}
            onPress={() => props.onScrollToMessage(row.messageId)}
            className="min-h-8 min-w-0 flex-row items-center gap-1.5 py-0.5"
          >
            <Text className="w-6 text-center text-sm text-foreground-muted">↳</Text>
            <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground-muted">
              To you · {messageFirstLine(row.body)}
            </Text>
          </Pressable>
        ),
      )}
    </View>
  );
}
