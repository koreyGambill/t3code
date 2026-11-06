import { type CSSProperties } from "react";

import { observeVisibleAnimation } from "../lib/visibleAnimation";
import { resolveThreadGlyph } from "../threadGlyphs";

export function ThreadGlyph({
  threadId,
  seed,
  className,
  working = false,
}: {
  threadId: string;
  seed?: number | undefined;
  className?: string | undefined;
  working?: boolean | undefined;
}) {
  const glyph = resolveThreadGlyph(threadId, seed);
  const colors: CSSProperties & {
    "--thread-glyph-light": string;
    "--thread-glyph-dark": string;
    "--thread-glyph-trace-light": string;
    "--thread-glyph-trace-dark": string;
  } = {
    "--thread-glyph-light": glyph.lightColor,
    "--thread-glyph-dark": glyph.color,
    "--thread-glyph-trace-light": glyph.lightTraceColor,
    "--thread-glyph-trace-dark": glyph.traceColor,
    color: "light-dark(var(--thread-glyph-light), var(--thread-glyph-dark))",
  };
  const label = `${glyph.colorName} ${glyph.name}${working ? ", working" : ""}`;
  return (
    <svg
      ref={working ? observeVisibleAnimation : undefined}
      role="img"
      aria-label={label}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${working ? "thread-glyph-working" : ""} ${className ?? ""}`}
      style={colors}
    >
      <title>{label}</title>
      {glyph.paths.map((path) => (
        <path key={path} d={path} />
      ))}
      {working ? (
        <g aria-hidden="true">
          {["primary", "secondary"].map((ember) => (
            <g
              key={ember}
              className={`thread-glyph-ember thread-glyph-ember-${ember}`}
              stroke="currentColor"
              strokeWidth="1"
            >
              <path d="M1.6 6A12 12 0 0 1 3.5 3.5" opacity="0.18" />
              <path d="M3.5 3.5A12 12 0 0 1 7.4 0.9" opacity="0.42" />
              <path d="M7.4 0.9A12 12 0 0 1 12 0" opacity="0.8" />
              <circle cx="12" cy="0" r="1.35" fill="currentColor" stroke="none" />
            </g>
          ))}
        </g>
      ) : null}
    </svg>
  );
}
