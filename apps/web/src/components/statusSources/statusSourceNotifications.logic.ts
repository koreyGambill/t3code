import type { StatusSource } from "@t3tools/contracts";

export function createStatusSourceNotificationGate() {
  let seen = new Map<string, string | null>();
  return {
    observe(sources: ReadonlyArray<StatusSource>, now: number): ReadonlyArray<StatusSource> {
      const changed: StatusSource[] = [];
      const next = new Map<string, string | null>();
      for (const source of sources) {
        const transition = source.lastTransition;
        const key = transition ? `${transition.at}:${transition.from}:${transition.to}` : null;
        next.set(source.config.id, key);
        if (!seen.has(source.config.id) || seen.get(source.config.id) === key || !transition)
          continue;
        const snoozed =
          source.config.snoozedUntil !== null && Date.parse(source.config.snoozedUntil) > now;
        if (snoozed) continue;
        const unhealthy = (state: string) => state === "warn" || state === "fail";
        if (
          (transition.from === "ok" && unhealthy(transition.to)) ||
          (unhealthy(transition.from) && transition.to === "ok")
        ) {
          changed.push(source);
        }
      }
      seen = next;
      return changed;
    },
  };
}
