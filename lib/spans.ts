import type { ParseSpan } from "./webr/types";

export interface SrcSel {
  line1: number; // 1-based
  col1: number; // 1-based inclusive
  line2: number;
  col2: number; // inclusive
}

function cmp(aL: number, aC: number, bL: number, bC: number): number {
  if (aL !== bL) return aL - bL;
  return aC - bC;
}

/**
 * Smallest complete expression (from R's getParseData) containing the
 * selection — the mechanism that turns an arbitrary editor selection into an
 * evaluatable AST chunk.
 */
export function smallestEnclosingSpan(spans: ParseSpan[], sel: SrcSel): ParseSpan | null {
  let best: ParseSpan | null = null;
  let bestSize = Infinity;
  for (const s of spans) {
    if (cmp(s.line1, s.col1, sel.line1, sel.col1) > 0) continue;
    if (cmp(s.line2, s.col2, sel.line2, sel.col2) < 0) continue;
    const size = (s.line2 - s.line1) * 10000 + (s.col2 - (s.line1 === s.line2 ? s.col1 : 0));
    if (size < bestSize) {
      bestSize = size;
      best = s;
    }
  }
  return best;
}

/** Extract the source text covered by a span. */
export function spanText(codeLines: string[], s: ParseSpan): string {
  if (s.line1 < 1 || s.line2 > codeLines.length) return "";
  if (s.line1 === s.line2) return codeLines[s.line1 - 1].slice(s.col1 - 1, s.col2);
  const parts = [codeLines[s.line1 - 1].slice(s.col1 - 1)];
  for (let ln = s.line1 + 1; ln < s.line2; ln++) parts.push(codeLines[ln - 1]);
  parts.push(codeLines[s.line2 - 1].slice(0, s.col2));
  return parts.join("\n");
}
