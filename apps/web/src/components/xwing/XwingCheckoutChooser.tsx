import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  CommandId,
  type DevelopmentEnvironmentCheckoutChoice,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Boxes } from "lucide-react";
import { useState } from "react";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { randomUUID } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  developmentEnvironmentCheckouts,
  selectDevelopmentEnvironmentCheckout,
  useXwingEnvironmentsSupport,
} from "../../state/xwingEnvironments";
import { ComposerControl } from "../chat/ComposerControl";
import { useComposerMenuProps } from "../chat/composerEventScope";
import { ComposerContextLabel } from "../ComposerContextLabel";
import { Badge } from "../ui/badge";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxStatus,
  ComboboxTrigger,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { filterXwingCheckoutChoices, xwingEnvironmentLabel } from "./xwingEnvironments.logic";

/**
 * Picks the Xwing environment a thread works in. The server lists the project's checkouts and
 * resolves the chosen one; a draft keeps the choice for its first send, and a started thread
 * moves when it is stopped.
 */
export function XwingCheckoutChooser({
  environmentId,
  threadId,
  draftId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftId: DraftId | null | undefined;
  readonly projectId: ProjectId;
}) {
  const supported = useXwingEnvironmentsSupport(environmentId);
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const composerFloatingLayerProps = useComposerMenuProps();
  const threadRef = scopeThreadRef(environmentId, threadId);
  const serverThread = useQuietThreadShell(threadRef);
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const selectCheckout = useAtomCommand(
    selectDevelopmentEnvironmentCheckout,
    "Move thread to Xwing environment",
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const list = useEnvironmentQuery(
    supported && canRead && open
      ? developmentEnvironmentCheckouts({ environmentId, input: { projectId } })
      : null,
  );
  if (!supported || !canRead || (serverThread !== null && !canOperate)) return null;

  const bound = serverThread?.developmentEnvironment ?? null;
  const selected =
    serverThread !== null
      ? bound && {
          id: bound.xwingEnvironmentId,
          label: xwingEnvironmentLabel({
            number: bound.number ?? undefined,
            name: bound.name,
          }),
        }
      : (draftThread?.xwingEnvironment ?? null);
  const choices = list.data ?? [];
  const visible = filterXwingCheckoutChoices(choices, query);
  const statusText =
    list.error ??
    (list.data === null
      ? "Loading environments…"
      : choices.length === 0
        ? "No active Xwing environment has a checkout of this project."
        : null);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const choose = (choice: DevelopmentEnvironmentCheckoutChoice) => {
    handleOpenChange(false);
    if (choice.xwingEnvironmentId === selected?.id) return;
    if (serverThread !== null) {
      void selectCheckout({
        environmentId,
        input: {
          threadId: serverThread.id,
          commandId: CommandId.make(randomUUID()),
          expected: {
            worktreePath: serverThread.worktreePath,
            xwingEnvironmentId: bound?.xwingEnvironmentId ?? null,
          },
          xwingEnvironmentId: choice.xwingEnvironmentId,
        },
      });
      return;
    }
    setDraftThreadContext(draftId ?? threadRef, {
      branch: choice.branch === "" ? null : choice.branch,
      worktreePath: choice.checkoutPath,
      envMode: "worktree",
      xwingEnvironment: {
        id: choice.xwingEnvironmentId,
        label: xwingEnvironmentLabel(choice),
      },
      projectRef: scopeProjectRef(environmentId, projectId),
    });
  };
  const byId = new Map(choices.map((choice) => [choice.xwingEnvironmentId as string, choice]));

  return (
    <Combobox
      items={choices.map((choice) => choice.xwingEnvironmentId as string)}
      filteredItems={visible.map((choice) => choice.xwingEnvironmentId as string)}
      autoHighlight
      open={open}
      onOpenChange={handleOpenChange}
      value={selected?.id ?? null}
      onValueChange={(value) => {
        const choice = typeof value === "string" ? byId.get(value) : undefined;
        if (choice) choose(choice);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              render={<ComposerControl size="xs" />}
              className="min-w-0 shrink active:scale-100"
              aria-label="Xwing environment"
              data-composer-context-control
            />
          }
        >
          <Boxes className="size-3 shrink-0" />
          {selected ? <ComposerContextLabel>{selected.label}</ComposerContextLabel> : null}
        </TooltipTrigger>
        <TooltipPopup>
          {selected
            ? serverThread !== null
              ? `Works in ${selected.label}. Choose another environment to move this stopped thread.`
              : `Starts in ${selected.label}.`
            : "Work in an Xwing environment"}
        </TooltipPopup>
      </Tooltip>
      <ComboboxPopup
        align="start"
        side="top"
        className="flex w-[min(24rem,calc(100vw-2rem))] flex-col"
        {...composerFloatingLayerProps}
      >
        <ComboboxSearchInput
          placeholder="Search environments..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {statusText === null ? <ComboboxEmpty>No environment matches.</ComboboxEmpty> : null}
        <ComboboxList className="max-h-64">
          {visible.map((choice, index) => (
            <ComboboxItem
              key={choice.xwingEnvironmentId}
              index={index}
              value={choice.xwingEnvironmentId}
              hideIndicator
            >
              <div className="flex w-full min-w-0 items-center gap-2">
                <span className="shrink-0 font-medium">{xwingEnvironmentLabel(choice)}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {choice.branch}
                </span>
                {choice.ticket ? (
                  <Badge size="sm" variant="outline">
                    {choice.ticket}
                  </Badge>
                ) : null}
              </div>
            </ComboboxItem>
          ))}
        </ComboboxList>
        {statusText ? <ComboboxStatus>{statusText}</ComboboxStatus> : null}
      </ComboboxPopup>
    </Combobox>
  );
}
