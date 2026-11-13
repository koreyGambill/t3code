import type { InputMessageReaction } from "@t3tools/client-runtime/state/message-reactions";
import { Chip } from "../../components/ui/Chip";
import * as Dialog from "../../components/ui/Dialog";

export function MessageReactionChip({
  reaction,
}: {
  readonly reaction?: InputMessageReaction | undefined;
}) {
  return reaction ? (
    <Chip
      label={reaction.label}
      icon={
        reaction.kind === "ack"
          ? "hand.thumbsup"
          : reaction.kind === "replied"
            ? "arrow.uturn.backward"
            : "info.circle"
      }
      size="small"
      accessibilityLabel={reaction.tooltip}
      onPress={() => Dialog.alert(reaction.label, reaction.tooltip)}
    />
  ) : null;
}
