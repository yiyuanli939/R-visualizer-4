"use client";

import { useMemo } from "react";
import type { TraceStep } from "@/lib/webr/types";
import { buildOutline } from "@/lib/outline";
import { useLang, useT } from "@/lib/i18n";

export default function OutlinePanel({
  code, steps, stepIdx, stale, onJump,
}: {
  code: string;
  steps: TraceStep[];
  stepIdx: number;
  stale: boolean;
  onJump: (i: number) => void;
}) {
  const { lang } = useLang();
  const t = useT();
  const chunks = useMemo(
    () => (steps.length && !stale ? buildOutline(code, steps, lang) : []),
    [code, steps, stale, lang],
  );

  if (!chunks.length) {
    return (
      <div className="flex-1 grid place-items-center p-4 text-center" style={{ color: "var(--ink-faint)" }}>
        {t("noOutline")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {chunks.map((c, i) => {
        const active = c.stepIdxs.includes(stepIdx);
        return (
          <button
            key={i}
            onClick={() => onJump(c.stepIdxs[0])}
            className="w-full text-left px-3 py-1.5 cursor-pointer block"
            style={{
              background: active ? "var(--blue-soft)" : "transparent",
              borderLeft: `3px solid ${active ? "var(--blue)" : "transparent"}`,
            }}
          >
            <div className="flex items-baseline gap-2">
              <span className="mono text-[11px] flex-none" style={{ color: "var(--ink-faint)" }}>
                L{c.line1}
              </span>
              <span className="text-[13px] font-medium truncate" style={{ color: "var(--ink)" }}>
                {c.hasError ? "⚠ " : ""}
                {c.title}
              </span>
            </div>
            {c.facts && (
              <div className="text-[11.5px] mt-0.5 pl-8 truncate" style={{ color: "var(--ink-dim)" }}>
                {c.facts}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
