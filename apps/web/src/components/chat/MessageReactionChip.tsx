import type { InputMessageReaction } from "@t3tools/client-runtime/state/message-reactions";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function MessageReactionChip({
  reaction,
}: {
  readonly reaction?: InputMessageReaction | undefined;
}) {
  return reaction ? (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" role="img" aria-label={reaction.tooltip} />}>
        {reaction.emoji}
      </TooltipTrigger>
      <TooltipPopup>{reaction.tooltip}</TooltipPopup>
    </Tooltip>
  ) : null;
}
