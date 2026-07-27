"use client";

import type { EnvSnapshot } from "@/lib/webr/types";
import { useLang } from "@/lib/i18n";

/**
 * Global change vocabulary, shown for every step:
 *   green  + name   created this step
 *   amber  ~ name   modified this step
 *   red    − name   removed this step
 * The same three colors mark changes in the memory graph (borders), data
 * table (cells/columns), variables panel and editor step strip — this bar is
 * the legend that makes the whole system explicit, and each chip is a jump
 * target (click focuses the object).
 */
export default function DeltaBar({
  env, stepKey, onSelect,
}: { env: EnvSnapshot | null; stepKey: number; onSelect: (name: string) => void }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  if (!env) return null;
  const groups: { sym: string; names: string[]; color: string; title: string }[] = [
    { sym: "+", names: env.added, color: "var(--add)", title: zh ? "本步新增" : "created this step" },
    { sym: "~", names: env.changed, color: "var(--chg)", title: zh ? "本步修改" : "modified this step" },
    { sym: "−", names: env.removed, color: "var(--del)", title: zh ? "本步删除" : "removed this step" },
  ];
  const any = groups.some((g) => g.names.length);
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1 flex-none overflow-x-auto"
      style={{ borderBottom: "1px solid var(--line)", minHeight: 26 }}
    >
      <span className="text-[10px] uppercase tracking-wide flex-none" style={{ color: "var(--ink-faint)" }}>
        Δ
      </span>
      {!any && (
        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {zh ? "本步无变量变化（输出/图形见对应面板）" : "no variable changes this step"}
        </span>
      )}
      {groups.map((g) =>
        g.names.map((n) => (
          <button
            key={`${g.sym}${n}-${stepKey}`}
            className="chip var-changed flex-none cursor-pointer mono text-[11px]"
            style={{ color: g.color, borderColor: g.color }}
            title={g.title}
            onClick={g.sym === "−" ? undefined : () => onSelect(n)}
          >
            {g.sym} {n}
          </button>
        )),
      )}
      <span className="ml-auto flex-none flex items-center gap-2 text-[10px]" style={{ color: "var(--ink-faint)" }}>
        <span><span style={{ color: "var(--add)" }}>●</span> {zh ? "新增" : "new"}</span>
        <span><span style={{ color: "var(--chg)" }}>●</span> {zh ? "修改" : "changed"}</span>
        <span><span style={{ color: "var(--del)" }}>●</span> {zh ? "删除" : "removed"}</span>
      </span>
    </div>
  );
}
