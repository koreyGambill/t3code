import { createFileRoute } from "@tanstack/react-router";

import { StatusSourcesSettings } from "../components/settings/StatusSourcesSettings";

export const Route = createFileRoute("/_chat/settings/status-sources")({
  component: StatusSourcesSettings,
});
