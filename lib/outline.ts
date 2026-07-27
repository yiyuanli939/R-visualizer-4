import type { Lang } from "./i18n";
import type { TraceStep } from "./webr/types";

/**
 * Chunk-level outline of a script: segments the code at comment blocks (the
 * natural section headers real analysis scripts already contain), then
 * summarizes what each chunk actually did from the trace facts.
 */

export interface Chunk {
  title: string;
  /** true when the title came from a real comment header (not a code fallback) */
  fromComment: boolean;
  line1: number;
  line2: number;
  stepIdxs: number[]; // indices into steps[]
  facts: string;
  hasError: boolean;
}

/** Clean a comment line into human text; "" if it is pure decoration. */
function commentText(line: string): string {
  let s = line.trim();
  if (!s.startsWith("#")) return "";
  s = s.replace(/^#+'?/, "").trim();          // leading #s / roxygen #'
  s = s.replace(/^[-=~*\s]+/, "").trim();     // leading rules
  s = s.replace(/[-=~*\s]+$/, "").trim();     // trailing rules
  // knitr chunk options like "message=FALSE, echo=FALSE" are not titles
  if (/^[a-zA-Z_.]+\s*=\s*[^,]+(,|$)/.test(s) && !s.includes(" ")) return "";
  if (/^(message|echo|eval|warning|include|label|fig)[=.\s]/.test(s)) return "";
  return s;
}

export function buildOutline(code: string, steps: TraceStep[], lang: Lang): Chunk[] {
  const zh = lang === "zh";
  const lines = code.split("\n");

  // segmentation: a run of comment/blank lines that follows code starts a new chunk
  const chunks: { title: string; fromComment: boolean; line1: number; line2: number }[] = [];
  let cur: { title: string; fromComment: boolean; line1: number; line2: number } | null = null;
  let pendingTitle = "";
  let pendingStart = -1;
  let sawCode = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const isComment = trimmed.startsWith("#");
    const isBlank = trimmed === "";

    if (isComment || isBlank) {
      if (isComment) {
        const t = commentText(raw);
        if (pendingStart === -1) pendingStart = i + 1;
        if (t && !pendingTitle) pendingTitle = t;
      } else if (pendingStart === -1 && sawCode) {
        pendingStart = i + 1;
      }
      continue;
    }

    // code line
    if (cur === null || pendingStart !== -1) {
      if (cur) cur.line2 = pendingStart - 1;
      cur = {
        title: pendingTitle || trimmed.slice(0, 60),
        fromComment: !!pendingTitle,
        line1: pendingStart === -1 ? i + 1 : pendingStart,
        line2: lines.length,
      };
      chunks.push(cur);
      pendingTitle = "";
      pendingStart = -1;
    }
    sawCode = true;
  }

  // attach steps + facts
  return chunks
    .map((c) => {
      const stepIdxs: number[] = [];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (s.line1 >= c.line1 && s.line1 <= c.line2) stepIdxs.push(i);
      }
      const created = new Set<string>();
      let plots = 0;
      let errors = 0;
      let pipeChains = 0;
      let loopSteps = 0;
      for (const i of stepIdxs) {
        const s = steps[i];
        for (const n of s.env.added) created.add(n);
        plots += s.plots.length;
        if (s.errorMsg) errors++;
        if (s.pipe?.index === 1) pipeChains++;
        if (s.loop?.length) loopSteps++;
      }
      const facts: string[] = [];
      if (created.size) {
        const names = [...created];
        const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? "…" : "");
        facts.push(zh ? `创建 ${shown}` : `creates ${shown}`);
      }
      if (pipeChains) facts.push(zh ? `${pipeChains} 条管道` : `${pipeChains} pipeline${pipeChains > 1 ? "s" : ""}`);
      if (loopSteps) facts.push(zh ? "循环" : "loop");
      if (plots) facts.push(zh ? `${plots} 张图` : `${plots} plot${plots > 1 ? "s" : ""}`);
      if (errors) facts.push(zh ? `${errors} 处错误` : `${errors} error${errors > 1 ? "s" : ""}`);
      if (!facts.length && stepIdxs.length)
        facts.push(zh ? `${stepIdxs.length} 步` : `${stepIdxs.length} step${stepIdxs.length > 1 ? "s" : ""}`);
      return {
        title: c.title,
        fromComment: c.fromComment,
        line1: c.line1,
        line2: c.line2,
        stepIdxs,
        facts: facts.join(" · "),
        hasError: errors > 0,
      };
    })
    .filter((c) => c.stepIdxs.length > 0);
}
