import type { Atom } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useRef } from "react";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";

export function BootstrapReconnect({
  generationAtom,
  onReconnect,
}: {
  generationAtom: Atom.Atom<number>;
  onReconnect: () => void;
}) {
  const generation = useAtomValue(generationAtom);
  const lastRetried = useRef(0);
  const retry = useEffectEvent(onReconnect);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retries the router's failed HTTP bootstrap when the connection runtime establishes a session
  useEffect(() => {
    if (generation === 0 || generation === lastRetried.current) return;
    lastRetried.current = generation;
    retry();
  }, [generation]);
  return (
    <StandalonePage>
      <StandalonePageHeader
        title="Reconnecting to environment"
        description="The environment is unavailable. This page will recover when it reconnects."
      />
    </StandalonePage>
  );
}
