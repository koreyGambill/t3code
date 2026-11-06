import type { EnvironmentId } from "@t3tools/contracts";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { useEnvironment } from "../../state/environments";

export function ComposerLocation({
  environmentId,
  cwd,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
}) {
  const environment = useEnvironment(environmentId);
  return (
    <div
      aria-label="Current computer and folder"
      className="me-2 flex min-w-16 flex-1 flex-col justify-center overflow-hidden text-3xs leading-tight text-muted-foreground"
    >
      <Tooltip>
        <TooltipTrigger render={<span className="block truncate" />}>
          {environment?.label ?? "Connecting…"}
        </TooltipTrigger>
        <TooltipPopup>{environment?.label ?? "Connecting…"}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<span className="block truncate font-mono" />}>
          {cwd ?? "No folder selected"}
        </TooltipTrigger>
        <TooltipPopup>{cwd ?? "No folder selected"}</TooltipPopup>
      </Tooltip>
    </div>
  );
}
