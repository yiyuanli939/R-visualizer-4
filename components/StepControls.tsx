"use client";

import { useMemo } from "react";
import { useT } from "@/lib/i18n";
import type { TraceStep } from "@/lib/webr/types";

export interface StepControlsProps {
  steps: TraceStep[];
  index: number; // 0-based
  onChange: (i: number) => void;
  stale: boolean;
}

export default function StepControls({ steps, index, onChange, stale }: StepControlsProps) {
  const t = useT();
  const n = steps.length;
  const ticks = useMemo(() => {
    if (n < 2) return [];
    const out: { pos: number; color: string }[] = [];
    for (let i = 0; i < n; i++) {
      const s = steps[i];
      if (s.kind === "error") out.push({ pos: i / (n - 1), color: "var(--del)" });
      else if (s.pipe && s.pipe.index === 1) out.push({ pos: i / (n - 1), color: "var(--blue)" });
      else if (s.loop && s.loop.length && steps[i - 1] && !steps[i - 1].loop)
        out.push({ pos: i / (n - 1), color: "var(--ink-faint)" });
    }
    return out;
  }, [steps, n]);

  if (!n) return null;
  const pct = n > 1 ? (index / (n - 1)) * 100 : 0;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-t"
      style={{ borderColor: "var(--line)", opacity: stale ? 0.45 : 1 }}
    >
      <button className="btn btn-icon" title={t("first")} onClick={() => onChange(0)} disabled={index === 0}>
        ⏮
      </button>
      <button className="btn btn-icon" title={t("prev")} onClick={() => onChange(index - 1)} disabled={index === 0}>
        ◀
      </button>
      <div className="step-track">
        <div className="step-rail" />
        <div className="step-fill" style={{ width: `${pct}%` }} />
        {ticks.map((tk, i) => (
          <div key={i} className="step-tick" style={{ left: `${tk.pos * 100}%`, background: tk.color }} />
        ))}
        <div className="step-thumb" style={{ left: `${pct}%` }} />
        <input
          type="range"
          min={0}
          max={n - 1}
          value={index}
          aria-label={t("step")}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <button
        className="btn btn-icon"
        title={t("next")}
        onClick={() => onChange(index + 1)}
        disabled={index >= n - 1}
      >
        ▶
      </button>
      <button
        className="btn btn-icon"
        title={t("last")}
        onClick={() => onChange(n - 1)}
        disabled={index >= n - 1}
      >
        ⏭
      </button>
      <span className="mono text-xs whitespace-nowrap" style={{ color: "var(--ink-dim)" }}>
        {t("step")} <b style={{ color: "var(--ink)" }}>{index + 1}</b> {t("of")} {n}
      </span>
    </div>
  );
}
