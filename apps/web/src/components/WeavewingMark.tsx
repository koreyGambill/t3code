import { useId, type SVGProps } from "react";

export function WeavewingMark(props: SVGProps<SVGSVGElement>) {
  const glowId = useId();
  return (
    <svg {...props} viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g
        fill="none"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${glowId})`}
      >
        <g className="stroke-(--weavewing-green)">
          <path d="M128 128L128 26M128 128L216 77M128 128L216 179M128 128L128 230M128 128L40 179M128 128L40 77" />
          <path d="M128 26Q153 85 216 77Q178 128 216 179Q153 171 128 230Q103 171 40 179Q78 128 40 77Q103 85 128 26Z" />
          <path d="M128 60Q145 99 187 94Q161 128 187 162Q145 157 128 196Q111 157 69 162Q95 128 69 94Q111 99 128 60Z" />
          <path d="M128 94Q136 114 157 111Q144 128 157 145Q136 142 128 162Q120 142 99 145Q112 128 99 111Q120 114 128 94Z" />
        </g>
        <g className="stroke-(--weavewing-yellow)">
          <path d="M128 128L216 179M128 128L40 77" />
          <path d="M128 26Q153 85 216 77M216 179Q153 171 128 230M128 196Q111 157 69 162M69 94Q111 99 128 60M128 94Q136 114 157 111M157 145Q136 142 128 162" />
        </g>
      </g>
    </svg>
  );
}
