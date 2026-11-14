import type { RunTrigger } from "./RunHistory.ts";

/** Opens every automation run's prompt, so the agent knows nobody is reading along. */
export function automationRunPreface(title: string, trigger: RunTrigger): string {
  // A webhook's summary is its delivery id, which tells the agent nothing.
  const why = trigger.type === "webhook" ? "a webhook request" : trigger.summary;
  return `[Automated run of "${title}" (${why}). Nobody is watching live; use t3_notify for anything the user must see.]\n\n`;
}
