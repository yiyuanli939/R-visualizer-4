"use client";

import { useEffect, useRef } from "react";
import type { InspectResult } from "@/lib/webr/types";
import ObjectTree from "./ObjectTree";
import { useLang } from "@/lib/i18n";

export interface InspectorState {
  src: string;
  coords: { x: number; y: number };
  loading: boolean;
  result?: InspectResult | null;
}

export default function InspectorPopover({
  state, onClose,
}: { state: InspectorState; onClose: () => void }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const r = state.result;
  const x = Math.min(state.coords.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 440);
  const y = Math.min(state.coords.y + 8, (typeof window !== "undefined" ? window.innerHeight : 800) - 320);

  return (
    <div
      ref={ref}
      className="panel fixed z-50 p-0"
      style={{ left: Math.max(8, x), top: Math.max(8, y), width: 420, maxHeight: 320, overflow: "hidden auto" }}
    >
      <div
        className="px-3 py-1.5 mono text-[12px] flex items-center gap-2"
        style={{ background: "var(--panel-2)", borderBottom: "1px solid var(--line)" }}
      >
        <span className="truncate font-medium" style={{ color: "var(--ink)" }} title={state.src}>
          {state.src}
        </span>
        {r?.resampled && (
          <span className="chip flex-none" style={{ color: "var(--chg)" }} title={zh ? "含随机函数：此处为重新抽样的值" : "contains random draws: re-sampled value"}>
            ⟲
          </span>
        )}
        <button className="ml-auto flex-none cursor-pointer" style={{ color: "var(--ink-faint)" }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="p-3 flex flex-col gap-2 text-[12.5px]">
        {state.loading && <div style={{ color: "var(--ink-dim)" }}>{zh ? "求值中…" : "Evaluating…"}</div>}

        {r?.fn && (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="mono font-semibold" style={{ color: "var(--blue)" }}>{r.fn.name}()</span>
              {r.fn.pkg && <span className="type-badge">{r.fn.pkg}</span>}
            </div>
            {r.fn.title && <div style={{ color: "var(--ink)" }}>{r.fn.title}</div>}
            {r.fn.sig && (
              <div className="mono text-[11px]" style={{ color: "var(--ink-faint)" }}>{r.fn.sig}</div>
            )}
          </div>
        )}

        {r?.note === "side-effect" && (
          <div style={{ color: "var(--chg)" }}>
            {zh ? "该调用有副作用，未重新求值（仅显示签名与文档）。" : "Side-effectful call — not re-evaluated (signature and docs only)."}
          </div>
        )}
        {r?.error && (
          <div style={{ color: "var(--del)" }}>
            {zh ? "无法在此上下文求值：" : "Could not evaluate here: "}
            {r.error}
          </div>
        )}

        {r?.value && (
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "var(--ink-faint)" }}>
              {zh ? "当前值" : "Value"}
            </div>
            <ValuePreview value={r.value} />
          </div>
        )}

        {!!r?.args?.length && (
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "var(--ink-faint)" }}>
              {zh ? "参数求值" : "Arguments"}
            </div>
            <table className="w-full mono text-[11.5px]">
              <tbody>
                {r.args.map((a, i) => (
                  <tr key={i} style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <td className="py-0.5 pr-2 align-top whitespace-nowrap" style={{ color: "var(--blue)" }}>
                      {a.name ? `${a.name} =` : ""}
                    </td>
                    <td className="py-0.5 pr-2 align-top" style={{ color: "var(--ink-dim)" }}>{a.code}</td>
                    <td className="py-0.5 align-top text-right" style={{ color: "var(--ink)" }}>{a.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ValuePreview({ value }: { value: NonNullable<InspectResult["value"]> }) {
  if (value.kind === "object" && value.tree) return <ObjectTree tree={value.tree} />;
  if (value.kind === "data.frame" || value.kind === "matrix") {
    const cols = value.cols ?? [];
    return (
      <div className="mono text-[11.5px]">
        <div style={{ color: "var(--ink)" }}>
          {(Array.isArray(value.cls) ? value.cls[0] : value.cls) ?? value.kind} · {value.nrow} × {value.ncol}
        </div>
        <div className="truncate" style={{ color: "var(--ink-dim)" }}>
          {cols.slice(0, 8).map((c) => `${c.name}<${c.type}>`).join("  ")}
          {cols.length > 8 ? " …" : ""}
        </div>
      </div>
    );
  }
  if (value.kind === "vector" || value.kind === "factor") {
    return (
      <div className="mono text-[12px]" style={{ color: "var(--ink)" }}>
        {(value.values ?? []).slice(0, 12).join(", ")}
        {(value.length ?? 0) > 12 ? ", …" : ""}
        <span style={{ color: "var(--ink-faint)" }}>
          {"  "}· {value.kind === "factor" ? `factor[${value.length}] · ${value.nlevels} levels` : `${value.vtype}[${value.length}]`}
        </span>
      </div>
    );
  }
  if (value.kind === "function") {
    return <div className="mono text-[11.5px]" style={{ color: "var(--ink-dim)" }}>{value.args}</div>;
  }
  if (value.kind === "null") return <div className="mono" style={{ color: "var(--ink-faint)" }}>NULL</div>;
  return (
    <div className="mono text-[11.5px]" style={{ color: "var(--ink-dim)" }}>
      {value.summary ?? (Array.isArray(value.cls) ? value.cls.join(", ") : String(value.cls ?? ""))}
    </div>
  );
}
