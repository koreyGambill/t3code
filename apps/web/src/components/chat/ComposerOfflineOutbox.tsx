import type { OfflineOutboxEntry } from "@t3tools/client-runtime/state/threads";
import { ClockIcon } from "lucide-react";
import { offlineOutbox } from "../../state/offlineOutbox";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

export function offlineOutboxBannerItem(entry: OfflineOutboxEntry): ComposerBannerStackItem {
  return {
    id: `offline:${entry.input.commandId}`,
    variant: entry.status === "failed" ? "error" : "info",
    icon: <ClockIcon />,
    title:
      entry.status === "failed"
        ? "Queued message was not sent"
        : entry.status === "sending"
          ? "Sending queued message"
          : entry.attempted
            ? "Delivery unconfirmed; retrying on reconnect"
            : "Queued locally; sends when reconnected",
    description:
      entry.error ??
      "Keep this page open. Reloading keeps the draft but cancels automatic sending.",
    children: (
      <p className="max-h-24 overflow-auto whitespace-pre-wrap text-sm">
        {entry.input.message.text}
      </p>
    ),
    actions:
      entry.status === "sending" ? undefined : (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => offlineOutbox.cancel(entry.input.commandId)}
        >
          {entry.status === "failed"
            ? "Dismiss"
            : entry.attempted
              ? "Stop retrying"
              : "Cancel queued message"}
        </Button>
      ),
  };
}
