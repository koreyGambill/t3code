import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { ThreadAttentionOverlay } from "./components/ThreadAttentionOverlay";
import { MonitoringRail } from "./components/monitoring/MonitoringRail";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      <ElectronBrowserHost />
      <MonitoringRail
        onOpenThread={(environmentId, threadId) => {
          void router.navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId, threadId },
          });
        }}
        onConfigure={(environmentId) => {
          void router.navigate({ to: "/settings/scheduled-tasks", search: { environmentId } });
        }}
      />
      <QuitHoldOverlay />
      <ThreadAttentionOverlay />
    </AppAtomRegistryProvider>
  );
}
