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
      <div className="pr-9">
        <RouterProvider router={router} />
      </div>
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
        onConfigureSources={(environmentId) => {
          void router.navigate({
            to: "/settings/status-sources",
            search: { machine: environmentId },
          });
        }}
      />
      <QuitHoldOverlay />
      <ThreadAttentionOverlay />
    </AppAtomRegistryProvider>
  );
}
