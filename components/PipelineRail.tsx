"use client";

import { Fragment, useMemo } from "react";
import type { TraceStep } from "@/lib/webr/types";
import { useT } from "@/lib/i18n";

export interface PipelineRailProps {
  steps: TraceStep[];
  index: number;
  onJump: (i: number) => void;
}

/** Contiguous run of pipe steps belonging to the same statement around `index`. */
export function pipeGroup(steps: TraceStep[], index: number): number[] {
  const cur = steps[index];
  if (!cur?.pipe) return [];
  let start = index;
  while (start > 0) {
    const p = steps[start - 1];
    if (p.pipe && p.pipe.total === cur.pipe.total && p.pipe.index < (steps[start].pipe?.index ?? 0)) start--;
    else break;
  }
  const group: number[] = [];
  for (let i = start; i < steps.length; i++) {
    const s = steps[i];
    if (s.pipe && (group.length === 0 || s.pipe.index === (steps[group[group.length - 1]].pipe?.index ?? 0) + 1)) {
      group.push(i);
      if (s.pipe.index === s.pipe.total) break;
    } else break;
  }
  return group;
}

function dimLabel(s: TraceStep): string {
  const v = s.pipe?.value;
  if (!v) return "";
  if (v.kind === "data.frame" || v.kind === "matrix") return `${v.nrow}×${v.ncol}`;
  if (v.kind === "vector" || v.kind === "factor") return `[${v.length}]`;
  if (v.kind === "object") {
    if (v.summary) return v.summary.length > 26 ? v.summary.slice(0, 25) + "…" : v.summary;
    const c = Array.isArray(v.cls) ? v.cls[0] : v.cls;
    return `<${c ?? "obj"}>`;
  }
  if (v.kind === "list") return `list(${v.length})`;
  if (v.kind === "null") return "NULL";
  return v.kind ?? "";
}

/** Row/col change vs the previous link, e.g. "−28r" or "+1c". */
function deltaLabel(steps: TraceStep[], si: number): { text: string; grew: boolean } | null {
  const cur = steps[si]?.pipe?.value;
  const prev = steps[si - 1]?.pipe?.value;
  if (!cur || !prev) return null;
  if (cur.kind !== "data.frame" && cur.kind !== "matrix") return null;
  if (prev.kind !== "data.frame" && prev.kind !== "matrix") return null;
  const dr = (cur.nrow ?? 0) - (prev.nrow ?? 0);
  const dc = (cur.ncol ?? 0) - (prev.ncol ?? 0);
  const parts: string[] = [];
  if (dr !== 0) parts.push(`${dr > 0 ? "+" : "−"}${Math.abs(dr)}r`);
  if (dc !== 0) parts.push(`${dc > 0 ? "+" : "−"}${Math.abs(dc)}c`);
  if (!parts.length) return null;
  return { text: parts.join(" "), grew: dr > 0 || dc > 0 };
}

export default function PipelineRail({ steps, index, onJump }: PipelineRailProps) {
  const t = useT();
  const group = useMemo(() => pipeGroup(steps, index), [steps, index]);
  if (!group.length) return null;

  return (
    <div
      className="flex items-center gap-0 px-3 py-2 overflow-x-auto flex-none"
      style={{ borderBottom: "1px solid var(--line)", background: "var(--panel-2)" }}
      aria-label={t("pipeline")}
    >
      {group.map((si, gi) => {
        const s = steps[si];
        const state = si === index ? "current" : si < index ? "done" : "";
        const delta = deltaLabel(steps, si);
        return (
          <Fragment key={si}>
            {gi > 0 &&
              (s.pipe?.op === "+" ? (
                <span className={`hexop ${si <= index ? "done" : ""}`}>+</span>
              ) : (
                <div className={`hexlink ${si <= index ? "done" : ""}`} />
              ))}
            <button className={`hexnode ${state}`} onClick={() => onJump(si)} title={s.pipe?.label}>
              <span className="hexlabel">{s.pipe?.label}</span>
              <span className="hexdim">
                {s.kind === "error" ? "⚠ error" : dimLabel(s)}
                {delta && s.kind !== "error" && (
                  <span
                    style={{
                      marginLeft: 4,
                      color: si === index ? "rgba(255,255,255,.9)" : delta.grew ? "var(--add)" : "var(--del)",
                    }}
                  >
                    {delta.text}
                  </span>
                )}
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
