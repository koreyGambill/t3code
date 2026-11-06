import { type CSSProperties } from "react";

import { resolveThreadGlyph } from "../threadGlyphs";

export function ThreadGlyph({
  threadId,
  seed,
  className,
}: {
  threadId: string;
  seed?: number | undefined;
  className?: string | undefined;
}) {
  const glyph = resolveThreadGlyph(threadId, seed);
  const colors: CSSProperties & {
    "--thread-glyph-light": string;
    "--thread-glyph-dark": string;
  } = {
    "--thread-glyph-light": glyph.lightColor,
    "--thread-glyph-dark": glyph.color,
    color: "light-dark(var(--thread-glyph-light), var(--thread-glyph-dark))",
  };
  return (
    <svg
      role="img"
      aria-label={`${glyph.colorName} ${glyph.name}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className ?? ""}`}
      style={colors}
    >
      <title>{`${glyph.colorName} ${glyph.name}`}</title>
      {glyph.paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
