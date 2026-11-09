import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { ComposerFooterPrimaryActions } from "./ComposerFooterControls";

it("lets the offline send button submit an existing thread and blocks resume", async () => {
  const submit = vi.fn();
  const props = {
    compact: false,
    canOperateThread: true,
    activeContextWindow: null,
    reserveContextWindowMeter: false,
    activeThreadModelDisplayName: null,
    isPreparingWorktree: false,
    pendingAction: null,
    isRunning: false,
    canInterrupt: false,
    followUpBehavior: "queue" as const,
    canSteer: false,
    alternateShortcutLabel: null,
    showPlanFollowUpPrompt: false,
    promptHasText: true,
    isSendBusy: false,
    sendDisabledReason: null,
    isEnvironmentUnavailable: true,
    canQueueOffline: true,
    hasSendableContent: true,
    canResume: false,
    isEditingQueuedMessage: false,
    onSubmitMessage: submit,
    onResume: vi.fn(),
    onPreviousPendingQuestion: vi.fn(),
    onInterrupt: vi.fn(),
    onImplementPlanInNewThread: vi.fn(),
    compactDisabled: true,
    compactDisabledReason: null,
  };
  await using screen = await render(<ComposerFooterPrimaryActions {...props} />);
  await screen.getByRole("button", { name: "Queue until reconnected" }).click();
  expect(submit).toHaveBeenCalledTimes(1);
  await screen.rerender(
    <ComposerFooterPrimaryActions
      {...props}
      promptHasText={false}
      hasSendableContent={false}
      canResume
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Environment disconnected" }))
    .toBeDisabled();
});
