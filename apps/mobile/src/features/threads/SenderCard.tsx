import { MessageReactionChip } from "./MessageReactionChip";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { ScopedThreadRef, TurnOrigin } from "@t3tools/contracts";
import { messageFirstLine, senderCardDetails } from "@t3tools/client-runtime/user-message";
import { resolveThreadGlyph } from "@t3tools/client-runtime/thread-glyphs";
import { AppText as Text } from "../../components/ui/AppText";
import { Chip } from "../../components/ui/Chip";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useQuietThreadShell, useThreadTitle } from "../../state/entities";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

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
  const sender = "threadId" in props.origin ? props.origin : null;
  const shell = useQuietThreadShell(sender);
  const details = senderCardDetails(props.origin, props.text);
  const glyph = sender ? resolveThreadGlyph(sender.threadId, shell?.glyphSeed) : null;
  const { themeAppearance } = useAppearancePreferences();
  const color = glyph ? (themeAppearance === "dark" ? glyph.color : glyph.lightColor) : undefined;
  const openThread = useOpenLinkedThread();
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="min-w-0">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${details.title}: ${messageFirstLine(props.text)}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        className="min-h-8 min-w-0 flex-row items-center gap-1.5 py-0.5"
      >
        <View className="w-6 shrink-0 items-center">
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
            <SymbolView name="gearshape" size={16} tintColorClassName="accent-foreground-muted" />
          )}
        </View>
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground-muted">
          {details.title} · {details.summary}
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
          {props.children ?? <Text className="text-sm text-foreground">{props.text}</Text>}
        </View>
      ) : null}
    </View>
  );
}

export function ThreadMessageLink(props: {
  readonly thread: ScopedThreadRef;
  readonly title?: string;
}) {
  const shell = useQuietThreadShell(props.thread);
  const liveTitle = useThreadTitle(props.thread);
  const title = props.title ?? (liveTitle?.trim() || "Thread");
  const glyph = resolveThreadGlyph(props.thread.threadId, shell?.glyphSeed);
  const { themeAppearance } = useAppearancePreferences();
  const color = themeAppearance === "dark" ? glyph.color : glyph.lightColor;
  const openThread = useOpenLinkedThread();
  return (
    <Pressable
      className="min-w-0 shrink flex-row items-center gap-1.5"
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={(event) => {
        event.stopPropagation();
        openThread(props.thread);
      }}
    >
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
      <Text
        numberOfLines={1}
        className="min-w-0 shrink font-t3-bold text-sm text-foreground-muted"
        style={{ color }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
