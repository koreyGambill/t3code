import type { ThreadUsagePoint } from "@t3tools/contracts";
import { usageSegments } from "./insightDisplay";

const number = (value: number | null) => (value === null ? "unknown" : value.toLocaleString());
export function UsageTimeline({ points }: { readonly points: ReadonlyArray<ThreadUsagePoint> }) {
  const max = Math.max(
    1,
    ...points.flatMap((point) => [point.inputTokens ?? 0, point.outputTokens ?? 0]),
  );
  if (!points.some((point) => point.inputTokens !== null || point.outputTokens !== null))
    return null;
  return (
    <figure className="space-y-3" aria-label="Reported token usage by provider turn">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-primary" />
          Input
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-success" />
          Output
        </span>
        <span>Faint: cached / reasoning</span>
      </div>
      <div
        className="max-h-72 space-y-3 overflow-y-auto rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        tabIndex={points.length > 5 ? 0 : undefined}
        role={points.length > 5 ? "region" : undefined}
        aria-label={points.length > 5 ? "Scroll token usage by turn" : undefined}
      >
        <div
          className="flex justify-between pl-12 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <span>0</span>
          <span>{number(max)}</span>
        </div>
        {points.map((point) => {
          const input = usageSegments(point.inputTokens, point.cachedInputTokens, max);
          const output = usageSegments(point.outputTokens, point.reasoningTokens, max);
          return (
            <div
              key={point.turnId}
              role="img"
              aria-label={`Turn ${point.ordinal}: input ${number(point.inputTokens)}, output ${number(point.outputTokens)}, cached ${number(point.cachedInputTokens)}, reasoning ${number(point.reasoningTokens)}`}
              className="flex items-center gap-3"
            >
              <span className="w-9 shrink-0 text-xs text-muted-foreground">
                Turn {point.ordinal}
              </span>
              <div className="min-w-0 flex-1 space-y-1" aria-hidden="true">
                {point.inputTokens === null ? (
                  <p className="text-xs text-muted-foreground">Input unavailable</p>
                ) : (
                  <div className="relative h-3">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-primary"
                      style={{ width: `${input.totalWidth * 100}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-background/45"
                      style={{ width: `${input.subsetWidth * 100}%` }}
                    />
                  </div>
                )}
                {point.outputTokens === null ? (
                  <p className="text-xs text-muted-foreground">Output unavailable</p>
                ) : (
                  <div className="relative h-3">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-success"
                      style={{ width: `${output.totalWidth * 100}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-background/45"
                      style={{ width: `${output.subsetWidth * 100}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
