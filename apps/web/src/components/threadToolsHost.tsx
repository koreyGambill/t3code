import type { ScopedThreadRef } from "@t3tools/contracts";
import { useRouterState } from "@tanstack/react-router";
import { createContext, use, useState, type ReactNode } from "react";
import { useEnvironmentIdentificationMode } from "../hooks/useSettings";
import { selectThreadTileLayout, useRightPanelStore } from "../rightPanelStore";
import { selectContextThread } from "../threadContextSidebar";
import { useThreadContextSidebarStore } from "../threadContextSidebarStore";
import { resolveThreadRouteRef } from "../threadRoutes";
import { ThreadDetailsDestination } from "./chat/ThreadDetailsDestination";
import {
  resolveSidebarStageBackdropVariant,
  useEnvironmentStageLabel,
} from "./SidebarStageBackdrop";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** The thread the sidebar's tools follow: a pinned thread, else the focused tile's. */
export function useThreadToolsTarget(): ScopedThreadRef | null {
  const owner = useRouterState({
    select: (state) => resolveThreadRouteRef(state.matches.at(-1)?.params ?? {}),
  });
  const surfaces = useRightPanelStore((state) =>
    owner ? state.byThreadKey[`${owner.environmentId}:${owner.threadId}`]?.surfaces : undefined,
  );
  const layout = useRightPanelStore((state) =>
    owner ? selectThreadTileLayout(state.byThreadKey, owner) : null,
  );
  const pinned = useThreadContextSidebarStore((state) => state.pinned);
  return selectContextThread(owner, layout, surfaces ?? [], pinned);
}

type Slot = HTMLDivElement | null;
const Slots = createContext<{
  details: Slot;
  setDetails: (element: Slot) => void;
  actions: Slot;
  setActions: (element: Slot) => void;
}>({ details: null, setDetails: () => {}, actions: null, setActions: () => {} });

/**
 * Holds the places the open tool renders into outside its own panel: the header's button slot,
 * and the Details view that the conversation's details card moves into.
 */
export function ThreadToolsHost({ children }: { children: ReactNode }) {
  const threadRef = useThreadToolsTarget();
  const view = useThreadContextSidebarStore((state) => state.view);
  const [details, setDetails] = useState<Slot>(null);
  const [actions, setActions] = useState<Slot>(null);
  return (
    <Slots value={{ details, setDetails, actions, setActions }}>
      <ThreadDetailsDestination
        value={view === "details" && threadRef && details ? { threadRef, element: details } : null}
      >
        {children}
      </ThreadDetailsDestination>
    </Slots>
  );
}

export function useThreadToolsSlots() {
  return use(Slots);
}

/** Whether the sidebar header sits on the environment's stage backdrop. */
export function useSidebarHeaderOnBackdrop(): boolean {
  const stageLabel = useEnvironmentStageLabel();
  const mode = useEnvironmentIdentificationMode();
  return resolveSidebarStageBackdropVariant(stageLabel, mode) !== null;
}

/** A button an open tool adds to the sidebar header, styled like the header's own. */
export function ToolHeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const onBackdrop = useSidebarHeaderOnBackdrop();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={onBackdrop ? "media-navigation" : "ghost"}
            size="icon-sm"
            className={onBackdrop ? "relative top-auto translate-y-0" : undefined}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
