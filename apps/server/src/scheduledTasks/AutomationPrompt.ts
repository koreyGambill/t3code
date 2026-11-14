import type { RunTrigger } from "./RunHistory.ts";

/** Opens every automation run's prompt, so the agent knows the run is automated. */
export function automationRunPreface(title: string, trigger: RunTrigger): string {
  // A webhook's summary is its delivery id, which tells the agent nothing.
  const why = trigger.type === "webhook" ? "a webhook request" : trigger.summary;
  // A person who pressed Run now may be reading along.
  const notify =
    trigger.type === "manual"
      ? "Use t3_notify for anything the user must see."
      : "Nobody is watching live; use t3_notify for anything the user must see.";
  return `[Automated run of "${title}" (${why}). ${notify}]\n\n`;
}
