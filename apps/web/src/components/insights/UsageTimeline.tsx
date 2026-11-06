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
  const height = 32 + points.length * 46;
  return (
    <figure className="space-y-2" aria-label="Reported token usage by provider turn">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-primary" />
          Input
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-success" />
          Output
        </span>
        <span>Faint segments: cache read / reasoning subsets</span>
      </div>
      <svg
        role="img"
        aria-label="Input and output tokens over provider turns. Values are also listed in the table below."
        viewBox={`0 0 520 ${height}`}
        className="w-full"
        style={{ minHeight: height / 2 }}
      >
        <text x="66" y="12" className="fill-muted-foreground text-3xs">
          0
        </text>
        <text x="504" y="12" textAnchor="end" className="fill-muted-foreground text-3xs">
          {number(max)}
        </text>
        {points.map((point, index) => {
          const input = usageSegments(point.inputTokens, point.cachedInputTokens, max);
          const output = usageSegments(point.outputTokens, point.reasoningTokens, max);
          const top = 22 + index * 46;
          return (
            <g key={point.turnId}>
              <title>{`Turn ${point.ordinal}: input ${number(point.inputTokens)}, output ${number(point.outputTokens)}, cached ${number(point.cachedInputTokens)}, reasoning ${number(point.reasoningTokens)}`}</title>
              <text x="56" y={top + 17} textAnchor="end" className="fill-muted-foreground text-3xs">
                Turn {point.ordinal}
              </text>
              <rect
                x="66"
                y={top}
                width={input.totalWidth * 438}
                height="12"
                rx="2"
                className="fill-primary"
              />
              <rect
                x="66"
                y={top}
                width={input.subsetWidth * 438}
                height="12"
                rx="2"
                className="fill-background/45"
              />
              <rect
                x="66"
                y={top + 16}
                width={output.totalWidth * 438}
                height="12"
                rx="2"
                className="fill-success"
              />
              <rect
                x="66"
                y={top + 16}
                width={output.subsetWidth * 438}
                height="12"
                rx="2"
                className="fill-background/45"
              />
              {point.inputTokens === null && (
                <text x="68" y={top + 10} className="fill-muted-foreground text-3xs">
                  Input unavailable
                </text>
              )}
              {point.outputTokens === null && (
                <text x="68" y={top + 26} className="fill-muted-foreground text-3xs">
                  Output unavailable
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        Cache reads are part of input; reasoning is part of output. Neither adds to the bar total.
      </figcaption>
    </figure>
  );
}
