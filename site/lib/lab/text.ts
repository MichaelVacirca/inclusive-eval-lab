/**
 * Deterministic, case-insensitive, whole-word term matching.
 * Response text is only ever searched; it can never change which terms are searched for.
 */

export interface Span {
  start: number;
  end: number;
  excerpt: string;
}

// A "word character" for boundary purposes: any letter, digit, or underscore.
const BEFORE = "(?<![\\p{L}\\p{N}_])";
const AFTER = "(?![\\p{L}\\p{N}_])";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escape a term and let each space match any run of whitespace. */
function termPattern(term: string): string {
  return term
    .trim()
    .split(/\s+/)
    .map(escapeRegex)
    .join("\\s+");
}

function alternation(terms: string[]): string | null {
  const cleaned = Array.from(new Set(terms.map((t) => t.trim()).filter((t) => t.length > 0)));
  if (cleaned.length === 0) return null;
  // Longest first, so "Alex Novak" wins over "Alex" at the same position.
  cleaned.sort((x, y) => y.length - x.length);
  return "(?:" + cleaned.map(termPattern).join("|") + ")";
}

function scan(text: string, pattern: string): Span[] {
  const re = new RegExp(pattern, "giu");
  const spans: Span[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    spans.push({ start: m.index, end: m.index + m[0].length, excerpt: m[0] });
  }
  return spans;
}

/** All non-overlapping whole-word matches of any term, sorted by start. */
export function findTerms(text: string, terms: string[]): Span[] {
  if (!text) return [];
  const alt = alternation(terms);
  if (!alt) return [];
  return scan(text, BEFORE + alt + AFTER);
}

/**
 * Matches a term only when it is anchored to its referent:
 *   "<anchor> <term>"            e.g. "your husband"
 *   "<term>,? <name>"            e.g. "husband Jordan", "husband, Jordan"
 *   "<name>,? <anchor> <term>"   e.g. "Jordan, your husband"
 * The span covers the whole phrase.
 */
export function findAnchored(text: string, terms: string[], anchors: string[], name?: string): Span[] {
  if (!text) return [];
  const termAlt = alternation(terms);
  const anchorAlt = alternation(anchors);
  if (!termAlt) return [];
  const nameAlt = name && name.trim() ? alternation([name]) : null;

  const b = (p: string) => BEFORE + p + AFTER;
  const parts: string[] = [];
  if (nameAlt && anchorAlt) parts.push(b(nameAlt) + ",?\\s+" + b(anchorAlt) + "\\s+" + b(termAlt));
  if (anchorAlt) parts.push(b(anchorAlt) + "\\s+" + b(termAlt));
  if (nameAlt) parts.push(b(termAlt) + ",?\\s+" + b(nameAlt));
  if (parts.length === 0) return [];
  return scan(text, "(?:" + parts.join("|") + ")");
}

/** Sort spans and merge any that overlap or touch. Returns new objects. */
export function mergeSpans(spans: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = spans
    .filter((s) => s.end > s.start)
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((x, y) => x.start - y.start || x.end - y.end);
  const out: Array<{ start: number; end: number }> = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
    } else {
      out.push(s);
    }
  }
  return out;
}
