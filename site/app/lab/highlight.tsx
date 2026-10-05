import type { ReactNode } from "react";
import { mergeSpans } from "../../lib/lab/text";

/**
 * Renders text with highlighted spans. Spans are clamped and merged, so
 * overlapping evidence renders each character once. Text is always rendered
 * as React text nodes, never as HTML.
 */
export function HighlightedText({
  text,
  spans,
  markClassName = "rounded-sm bg-amber-300/20 text-zinc-100 underline decoration-amber-300 decoration-2 underline-offset-2",
}: {
  text: string;
  spans: Array<{ start: number; end: number }>;
  markClassName?: string;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(text.length, Math.floor(n)));
  const merged = mergeSpans(
    spans
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
      .map((s) => ({ start: clamp(s.start), end: clamp(s.end) }))
      .filter((s) => s.end > s.start),
  );
  const parts: ReactNode[] = [];
  let pos = 0;
  merged.forEach((s, i) => {
    if (s.start > pos) parts.push(text.slice(pos, s.start));
    parts.push(
      <mark key={i} className={markClassName}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    pos = s.end;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}
