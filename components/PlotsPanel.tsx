"use client";

import { useMemo, useState } from "react";
import type { TraceStep } from "@/lib/webr/types";
import { useT } from "@/lib/i18n";

export default function PlotsPanel({
  steps, index, plotUrls,
}: { steps: TraceStep[]; index: number; plotUrls: string[] }) {
  const t = useT();
  const [zoom, setZoom] = useState<number | null>(null);

  // plots produced up to the current step; the newest is highlighted
  const visible = useMemo(() => {
    const ids: number[] = [];
    for (let i = 0; i <= Math.min(index, steps.length - 1); i++) {
      for (const p of steps[i].plots) if (!ids.includes(p)) ids.push(p);
    }
    return ids;
  }, [steps, index]);

  if (!visible.length) {
    return (
      <div className="flex-1 grid place-items-center p-4" style={{ color: "var(--ink-faint)" }}>
        {t("noPlots")}
      </div>
    );
  }

  const latest = visible[visible.length - 1];
  // animation-style loops can produce hundreds of pages; keep the DOM light
  const MAX_SHOWN = 12;
  const shown = visible.slice(-MAX_SHOWN);
  const hidden = visible.length - shown.length;

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 items-center">
      {hidden > 0 && (
        <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
          … {hidden} earlier plot{hidden > 1 ? "s" : ""} hidden
        </div>
      )}
      {shown.map((id) => {
        const url = plotUrls[id - 1];
        if (!url) return null;
        return (
          <figure key={id} className="w-full max-w-[720px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Plot ${id}`}
              className="w-full h-auto rounded-lg cursor-zoom-in"
              style={{
                border: `2px solid ${id === latest ? "var(--accent)" : "var(--line)"}`,
                background: "#fff",
              }}
              onClick={() => setZoom(id)}
            />
          </figure>
        );
      })}
      {zoom !== null && plotUrls[zoom - 1] && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-8 cursor-zoom-out"
          style={{ background: "rgba(8, 12, 22, 0.8)" }}
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={plotUrls[zoom - 1]}
            alt={`Plot ${zoom}`}
            className="max-w-full max-h-[85vh] rounded-lg"
            style={{ background: "#fff" }}
          />
          <div className="flex gap-2 mt-3">
            <a
              className="btn"
              href={plotUrls[zoom - 1]}
              download={`plot-${zoom}.png`}
              onClick={(e) => e.stopPropagation()}
            >
              ↓ {t("download")}
            </a>
            <button className="btn" onClick={() => setZoom(null)}>{t("close")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
