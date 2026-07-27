"use client";

import { useEffect, useMemo, useRef } from "react";
import type { TraceStep } from "@/lib/webr/types";
import { useT } from "@/lib/i18n";

interface Line {
  text: string;
  cls: string;
  step: number;
}

export default function ConsolePanel({
  steps, index, globalError,
}: { steps: TraceStep[]; index: number; globalError?: string | null }) {
  const t = useT();
  const endRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => {
    const out: Line[] = [];
    for (let i = 0; i <= Math.min(index, steps.length - 1); i++) {
      const s = steps[i];
      for (const l of s.stdout) out.push({ text: l, cls: "", step: s.i });
      for (const c of s.conds ?? []) {
        out.push({
          text: (c.type === "warning" ? "Warning: " : "") + c.text,
          cls: c.type === "warning" ? "warn" : "msg",
          step: s.i,
        });
      }
      if (s.errorMsg) out.push({ text: `Error: ${s.errorMsg}`, cls: "err", step: s.i });
    }
    return out;
  }, [steps, index]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length, index]);

  const currentStepId = steps[index]?.i;

  if (!lines.length && !globalError) {
    return (
      <div className="flex-1 grid place-items-center p-4" style={{ color: "var(--ink-faint)" }}>
        {t("noOutput")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 mono text-xs">
      {globalError && <div className="console-line err mb-1">{globalError}</div>}
      {lines.map((l, i) => (
        <div
          key={i}
          className={`console-line ${l.cls}`}
          style={l.step === currentStepId ? { background: "var(--accent-soft)" } : undefined}
        >
          {l.text || " "}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
