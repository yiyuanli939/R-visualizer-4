"use client";

import { useMemo } from "react";
import type { TraceStep } from "@/lib/webr/types";
import { explainStep } from "@/lib/explain";
import { useLang } from "@/lib/i18n";

export default function ExplainBar({
  step, prevStep, code, stale, sectionTitle,
}: {
  step: TraceStep | undefined;
  prevStep: TraceStep | undefined;
  code: string;
  stale: boolean;
  sectionTitle?: string | null;
}) {
  const { lang } = useLang();
  const text = useMemo(() => {
    if (!step || stale) return null;
    return explainStep(step, prevStep, code.split("\n"), lang);
  }, [step, prevStep, code, stale, lang]);

  if (!text) return null;
  const isError = !!step?.errorMsg;
  return (
    <div
      className="px-3 py-1.5 text-[12.5px] leading-snug flex gap-2 items-baseline flex-none"
      style={{
        borderBottom: "1px solid var(--line)",
        background: isError ? "var(--del-soft)" : "var(--blue-soft)",
        color: isError ? "var(--del)" : "var(--ink)",
      }}
    >
      <span aria-hidden className="flex-none select-none">{isError ? "⚠" : "💡"}</span>
      <span>
        {sectionTitle && (
          <span className="font-semibold" style={{ color: "var(--blue)" }}>
            【{sectionTitle}】{" "}
          </span>
        )}
        {text}
      </span>
    </div>
  );
}
