import {
  resolveSnoozePresets,
  pickSnoozePreset,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";
import { ClockIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { formatShortTimestamp } from "../../timestampFormat";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

export function ReviewReminderMenu({
  disabled,
  remindAt,
  onChange,
}: {
  readonly disabled: boolean;
  readonly remindAt: string | null;
  readonly onChange: (remindAt: string | null) => void;
}) {
  const format = useClientSettings((settings) => settings.timestampFormat);
  const [presets, setPresets] = useState<ReadonlyArray<SnoozePreset>>([]);
  const formatTime = (date: Date) => formatShortTimestamp(date.toISOString(), format);
  return (
    <Menu
      onOpenChange={(open) => {
        if (open) setPresets(resolveSnoozePresets(new Date(), { formatTime }));
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-micro"
                  disabled={disabled}
                  aria-label={remindAt ? "Change reminder" : "Remind me later"}
                />
              }
            />
          }
        >
          <ClockIcon />
        </TooltipTrigger>
        <TooltipPopup>{remindAt ? "Change reminder" : "Remind me later"}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        {presets.map((preset) => (
          <MenuItem
            key={preset.id}
            onClick={() => {
              const picked = pickSnoozePreset({
                shown: presets,
                id: preset.id,
                now: new Date(),
                formatTime,
              });
              if (picked) onChange(picked.snoozedUntil);
            }}
          >
            {preset.label}
          </MenuItem>
        ))}
        <MenuItem
          onClick={() => {
            void requestCustomSnooze({
              title: "Review reminder",
              description: "Choose when this review needs your attention again.",
            }).then((choice) => {
              if (choice) onChange(choice.snoozedUntil);
            });
          }}
        >
          Choose date and time…
        </MenuItem>
        {remindAt ? <MenuItem onClick={() => onChange(null)}>Cancel reminder</MenuItem> : null}
      </MenuPopup>
    </Menu>
  );
}
