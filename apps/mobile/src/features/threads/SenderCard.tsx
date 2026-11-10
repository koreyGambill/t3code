import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { MaskedView } from "@expo/ui/community/masked-view";
import Svg, { Defs, LinearGradient, Rect, Stop, Path } from "react-native-svg";
import type { TurnOrigin } from "@t3tools/contracts";
import { senderCardDetails } from "@t3tools/client-runtime/user-message";
import { resolveThreadGlyph } from "@t3tools/client-runtime/thread-glyphs";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useQuietThreadShell } from "../../state/entities";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

export function SenderCard(props: {
  readonly origin: Exclude<TurnOrigin, { kind: "user" }>;
  readonly text: string;
  readonly queued?: boolean;
  readonly children?: ReactNode;
}) {
  const details = senderCardDetails(props.origin);
  const sender = "threadId" in props.origin ? props.origin : null;
  const shell = useQuietThreadShell(sender);
  const glyph = sender ? resolveThreadGlyph(sender.threadId, shell?.glyphSeed) : null;
  const { themeAppearance } = useAppearancePreferences();
  const color = glyph ? (themeAppearance === "dark" ? glyph.color : glyph.lightColor) : undefined;
  const openThread = useOpenLinkedThread();
  const [expanded, setExpanded] = useState(false);
  const long = props.text.length > 600 || props.text.split("\n").length > 6;
  return (
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
            <SymbolView name="gearshape" size={16} tintColorClassName="accent-foreground-muted" />
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
      {long && !expanded ? (
        <MaskedView
          style={{ maxHeight: 176, overflow: "hidden" }}
          maskElement={
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="sender-fade" x1="0%" x2="0%" y1="0%" y2="100%">
                  <Stop offset="0.85" stopColor="white" />
                  <Stop offset="1" stopColor="white" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#sender-fade)" />
            </Svg>
          }
        >
          <View>
            {props.children ?? <Text className="text-sm text-foreground">{props.text}</Text>}
          </View>
        </MaskedView>
      ) : (
        (props.children ?? <Text className="text-sm text-foreground">{props.text}</Text>)
      )}
      {long ? (
        <Button
          label={expanded ? "Show less" : "Show full message"}
          tone="text"
          size="compact"
          onPress={() => setExpanded(!expanded)}
        />
      ) : null}
    </View>
  );
}
