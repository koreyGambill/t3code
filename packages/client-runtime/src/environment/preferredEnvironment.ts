/** Where new work runs when nothing names a machine, or why the preferred one cannot take it. */
export type WorkEnvironmentChoice<Id extends string> =
  | { readonly kind: "chosen"; readonly environmentId: Id }
  | { readonly kind: "preferred-unavailable"; readonly environmentId: Id }
  | { readonly kind: "none" };

/**
 * Picks the machine for new work nothing on screen names: a known preferred machine (reported
 * when it cannot take the work, never swapped), else `fallback`. Explicit choices skip this.
 * @example chooseWorkEnvironment({ preferred, isKnown, isUsable, fallback: () => primaryId })
 */
export function chooseWorkEnvironment<Id extends string>(input: {
  readonly preferred: Id | null;
  readonly isKnown: (environmentId: Id) => boolean;
  readonly isUsable: (environmentId: Id) => boolean;
  readonly fallback: () => Id | null;
}): WorkEnvironmentChoice<Id> {
  if (input.preferred !== null && input.isKnown(input.preferred)) {
    return input.isUsable(input.preferred)
      ? { kind: "chosen", environmentId: input.preferred }
      : { kind: "preferred-unavailable", environmentId: input.preferred };
  }
  const fallback = input.fallback();
  return fallback === null ? { kind: "none" } : { kind: "chosen", environmentId: fallback };
}

export function chosenEnvironmentId<Id extends string>(choice: WorkEnvironmentChoice<Id>) {
  return choice.kind === "chosen" ? choice.environmentId : null;
}

/** The machine a view of per-machine details opens on: the known preference, else `fallback`. */
export function preferredOrFallbackEnvironmentId<Id extends string>(
  preferred: Id | null,
  isKnown: (environmentId: Id) => boolean,
  fallback: Id | null,
): Id | null {
  return preferred !== null && isKnown(preferred) ? preferred : fallback;
}
