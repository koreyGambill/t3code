import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { AutomationThreadContext } from "@t3tools/client-runtime/automations";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScheduledTask,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";

import { requestWorkspaceFocus } from "../../lib/workspaceFocus";
import { useQuietThreadShell, useQuietThreadShells } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { stackedThreadToast, toastManager } from "../ui/toast";

export const automationRowKey = (environmentId: string, taskId: string) =>
  `${environmentId}\n${taskId}`;

/** The open thread's project and ancestors, as the server's event filters see them. */
export function useThreadContext(
  threadRef: ScopedThreadRef | null,
): AutomationThreadContext | null {
  const shell = useQuietThreadShell(threadRef);
  const shells = useQuietThreadShells();
  if (threadRef === null || shell === null) return null;
  const lineage: string[] = [shell.id];
  let parent = shell.lineage.parentThreadId ?? shell.delegatedFrom?.threadId ?? null;
  while (parent !== null && lineage.length < 32 && !lineage.includes(parent)) {
    lineage.push(parent);
    const next = shells.find(
      (entry) => entry.environmentId === threadRef.environmentId && entry.id === parent,
    );
    parent = next?.lineage.parentThreadId ?? next?.delegatedFrom?.threadId ?? null;
  }
  return { threadId: shell.id, projectId: shell.projectId, lineage };
}

export type AutomationActions = ReturnType<typeof useAutomationActions>;

export function useAutomationActions(environmentId: EnvironmentId) {
  const [busy, setBusy] = useState(false);
  const canOperate = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "automation toggle",
  });
  const setThreadEnabled = useAtomCommand(serverEnvironment.setScheduledTaskThreadEnabled, {
    label: "automation thread toggle",
  });
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "automation run now",
  });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    label: "automation delete",
  });
  const act = async (
    title: string,
    command: () => Promise<AtomCommandResult<unknown, unknown>>,
  ): Promise<boolean> => {
    if (busy || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return false;
    setBusy(true);
    const result = await command();
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return result._tag === "Success";
  };
  return {
    busy,
    canOperate,
    setEnabled: (task: ScheduledTask, enabled: boolean) =>
      act("Could not update automation", () =>
        setEnabled({ environmentId, input: { id: task.id, enabled } }),
      ),
    setThreadEnabled: (task: ScheduledTask, threadId: string, enabled: boolean) =>
      act("Could not update automation", () =>
        setThreadEnabled({
          environmentId,
          input: { id: task.id, threadId: ThreadId.make(threadId), enabled },
        }),
      ),
    runNow: (task: ScheduledTask) =>
      act("Could not run automation", () => runNow({ environmentId, input: { id: task.id } })),
    remove: (task: ScheduledTask) =>
      act("Could not delete automation", () => remove({ environmentId, input: { id: task.id } })),
  };
}

export function useOpenThread() {
  const navigate = useNavigate();
  return async (environmentId: EnvironmentId, threadId: string, focusComposer = false) => {
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, ThreadId.make(threadId))),
    });
    if (focusComposer) requestWorkspaceFocus({ area: "composer" });
  };
}
