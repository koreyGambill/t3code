import { type CSSProperties, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useViewportSize } from "../hooks/useViewportSize";
import {
  readThreadAttention,
  subscribeThreadAttention,
  THREAD_ATTENTION_DURATION_MS,
} from "../threadAttention";
import { ThreadGlyph } from "./ThreadGlyph";

export function ThreadAttentionOverlay() {
  const alert = useSyncExternalStore(subscribeThreadAttention, readThreadAttention);
  const { width, height } = useViewportSize();
  if (!alert) return null;
  const size = Math.min(Math.sqrt(width * height * 0.5), width * 0.95, height * 0.95);
  const style: CSSProperties & { "--thread-attention-duration": string } = {
    width: size,
    height: size,
    "--thread-attention-duration": `${THREAD_ATTENTION_DURATION_MS}ms`,
  };
  return createPortal(
    <div className="thread-attention-overlay" role="status" data-thread-attention={alert.threadId}>
      <span className="sr-only">{alert.title} needs your attention</span>
      <div key={alert.sequence} className="thread-attention-flash" style={style} aria-hidden="true">
        <ThreadGlyph threadId={alert.threadId} seed={alert.seed} className="size-full" />
      </div>
    </div>,
    document.body,
  );
}
