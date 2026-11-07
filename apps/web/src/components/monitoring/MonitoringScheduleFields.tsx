import type { ScheduledTaskSchedule } from "@t3tools/contracts";

import { toDateTimeLocalValue } from "../settings/scheduledTasksSettings.logic";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

type TimedSchedule = Extract<ScheduledTaskSchedule, { type: "interval" | "fixed_time" | "once" }>;

export function MonitoringScheduleFields({
  schedule,
  onChange,
  disabled,
}: {
  schedule: TimedSchedule;
  onChange: (schedule: TimedSchedule) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="watcher-schedule">Schedule</Label>
      <Select
        value={schedule.type}
        disabled={disabled}
        onValueChange={(value) => {
          if (value === "interval") onChange({ type: value, everyMs: 15 * 60_000 });
          if (value === "fixed_time") onChange({ type: value, timeOfDay: "09:00" });
          if (value === "once") onChange({ type: value, runAt: new Date().toISOString() });
        }}
      >
        <SelectTrigger id="watcher-schedule">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="interval">Interval</SelectItem>
          <SelectItem value="fixed_time">Fixed time</SelectItem>
          <SelectItem value="once">Once</SelectItem>
        </SelectPopup>
      </Select>
      {schedule.type === "interval" ? (
        <div className="space-y-1">
          <Label htmlFor="watcher-interval">Every (minutes)</Label>
          <Input
            id="watcher-interval"
            type="number"
            min={1}
            step={1}
            value={schedule.everyMs / 60_000}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...schedule, everyMs: Number(event.target.value) * 60_000 })
            }
          />
        </div>
      ) : schedule.type === "fixed_time" ? (
        <div className="space-y-1">
          <Label htmlFor="watcher-time">Local time</Label>
          <Input
            id="watcher-time"
            type="time"
            value={schedule.timeOfDay}
            disabled={disabled}
            onChange={(event) => onChange({ ...schedule, timeOfDay: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {schedule.weekdays?.length
              ? `Days: ${schedule.weekdays.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")}`
              : "Every day"}{" "}
            · environment local time
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Run on weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, day) => {
              const days = schedule.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
              return (
                <label key={label} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={days.includes(day)}
                    disabled={disabled || (days.length === 1 && days.includes(day))}
                    onChange={(event) =>
                      onChange({
                        ...schedule,
                        weekdays: event.target.checked
                          ? [...days, day].toSorted()
                          : days.filter((value) => value !== day),
                      })
                    }
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="watcher-once">Run at</Label>
          <Input
            id="watcher-once"
            type="datetime-local"
            value={toDateTimeLocalValue(new Date(schedule.runAt))}
            disabled={disabled}
            onChange={(event) => {
              const date = new Date(event.target.value);
              if (Number.isFinite(date.getTime()))
                onChange({ ...schedule, runAt: date.toISOString() });
            }}
          />
        </div>
      )}
    </div>
  );
}
