import { type CSSProperties } from "react";

import { observeVisibleAnimation } from "../lib/visibleAnimation";
import { resolveThreadGlyph } from "../threadGlyphs";

export function ThreadGlyph({
  threadId,
  seed,
  className,
  working = false,
  attention = false,
}: {
  threadId: string;
  seed?: number | undefined;
  className?: string | undefined;
  working?: boolean | undefined;
  attention?: boolean | undefined;
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
  const label = `${glyph.colorName} ${glyph.name}${working ? ", working" : ""}${attention ? ", needs attention" : ""}`;
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
      className={`shrink-0 overflow-visible ${working ? "thread-glyph-working" : ""} ${className ?? ""}`}
      style={colors}
    >
      <title>{label}</title>
      {glyph.paths.map((path) => (
        <path key={path} d={path} />
      ))}
      {attention ? <circle className="thread-glyph-notification-dot" cx="20" cy="4" r="3" /> : null}
      {working ? (
        <g
          aria-hidden="true"
          transform="translate(12 12) rotate(-25) scale(1 0.62) translate(-12 -12)"
        >
          {["primary", "secondary"].map((ember) => (
            <g
              key={ember}
              className={`thread-glyph-ember thread-glyph-ember-${ember}`}
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M-8.85 0A24 24 0 0 1 -4.95 -4.95" opacity="0.18" />
              <path d="M-4.95 -4.95A24 24 0 0 1 2.85 -10.2" opacity="0.42" />
              <path d="M2.85 -10.2A24 24 0 0 1 12 -12" opacity="0.8" />
              <circle cx="12" cy="-12" r="2.25" fill="currentColor" stroke="none" />
            </g>
          ))}
        </g>
      ) : null}
    </svg>
  );
}
