"use client";

import type { EnvSnapshot, ObjPreview } from "@/lib/webr/types";
import { useT } from "@/lib/i18n";

function summary(o: ObjPreview): string {
  switch (o.kind) {
    case "data.frame":
    case "matrix":
      return `${o.nrow} × ${o.ncol}`;
    case "vector": {
      const vals = (o.values ?? []).slice(0, 5).join(", ");
      return (o.length ?? 0) === 1 ? vals : `[${o.length}] ${vals}${(o.length ?? 0) > 5 ? ", …" : ""}`;
    }
    case "factor":
      return `[${o.length}] ${o.nlevels} levels`;
    case "list":
      return `list of ${o.length}`;
    case "function":
      return o.args ?? "function(…)";
    case "null":
      return "NULL";
    case "object":
      return o.summary ?? (Array.isArray(o.cls) ? o.cls[0] : String(o.cls ?? ""));
    default:
      return Array.isArray(o.cls) ? o.cls.join("/") : String(o.cls ?? "");
  }
}

function typeOf(o: ObjPreview): string {
  if (o.kind === "data.frame") {
    const c = Array.isArray(o.cls) ? o.cls[0] : o.cls;
    return c === "tbl_df" ? "tibble" : "df";
  }
  if (o.kind === "vector") return o.vtype ?? "vec";
  if (o.kind === "matrix") return "mat";
  if (o.kind === "factor") return "fct";
  if (o.kind === "function") return "fn";
  if (o.kind === "object") {
    const t = o.tree?.type;
    if (t === "s7") return "S7";
    if (t === "s4") return "S4";
    if (t === "r6") return "R6";
    if (t === "env") return "env";
    if (t === "list") return "list";
    const c = Array.isArray(o.cls) ? o.cls[0] : o.cls;
    return String(c ?? "obj").slice(0, 8);
  }
  return o.kind ?? "?";
}

export interface VariablesPanelProps {
  env: EnvSnapshot | null;
  selected: string | null;
  onSelect: (name: string) => void;
  stepKey: number;
}

export default function VariablesPanel({ env, selected, onSelect, stepKey }: VariablesPanelProps) {
  const t = useT();
  if (!env || (!env.objs?.length && !env.removed.length)) {
    return (
      <div className="flex-1 grid place-items-center p-4 text-center" style={{ color: "var(--ink-faint)" }}>
        {t("noVars")}
      </div>
    );
  }
  const added = new Set(env.added);
  const changed = new Set(env.changed);
  return (
    <div className="flex-1 overflow-y-auto py-1">
      {env.objs.map((o) => {
        const isSel = selected === o.name;
        const isNew = added.has(o.name);
        const isChg = changed.has(o.name);
        return (
          <button
            key={o.name}
            onClick={() => onSelect(o.name)}
            className={`w-full text-left px-3 py-1 flex items-center gap-2 cursor-pointer ${isChg || isNew ? "var-changed" : ""}`}
            style={{
              background: isSel ? "var(--blue-soft)" : "transparent",
              borderLeft: `3px solid ${isNew ? "var(--add)" : isChg ? "var(--chg)" : "transparent"}`,
            }}
          >
            <span className="mono text-[13px] font-medium truncate" style={{ color: "var(--ink)" }}>
              {o.name}
            </span>
            <span className="type-badge flex-none">{typeOf(o)}</span>
            <span className="mono text-xs truncate ml-auto" style={{ color: "var(--ink-dim)" }} key={stepKey}>
              {summary(o)}
            </span>
          </button>
        );
      })}
      {env.removed.map((name) => (
        <div key={name} className="px-3 py-1 flex items-center gap-2" style={{ opacity: 0.55 }}>
          <span className="mono text-[13px] line-through" style={{ color: "var(--del)" }}>{name}</span>
          <span className="text-xs" style={{ color: "var(--ink-faint)" }}>{t("removed")}</span>
        </div>
      ))}
    </div>
  );
}
