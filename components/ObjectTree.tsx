"use client";

import { useState } from "react";
import type { ObjTreeNode } from "@/lib/webr/types";

const TYPE_COLORS: Record<string, string> = {
  s7: "var(--accent)",
  s4: "var(--accent)",
  r6: "var(--accent)",
  env: "var(--chg)",
  ggproto: "var(--ink-faint)",
  function: "var(--blue)",
};

function nodeSummary(n: ObjTreeNode): string {
  const cls = Array.isArray(n.cls) ? n.cls[0] : n.cls;
  switch (n.type) {
    case "df":
    case "matrix":
      return `${cls} ${n.dims ?? ""}`;
    case "factor":
      return `factor · ${n.dims ?? ""} · ${(n.preview as string[] | undefined)?.slice(0, 4).join(", ") ?? ""}`;
    case "atomic": {
      const vals = (n.preview as string[] | undefined)?.join(", ") ?? "";
      return n.n === 1 ? vals : `${n.vtype ?? ""}[${n.n}] ${vals}${(n.n ?? 0) > 6 ? ", …" : ""}`;
    }
    case "function":
      return n.sig ?? "function";
    case "null":
      return "NULL";
    case "list":
      return `list(${n.n ?? 0})`;
    case "ggproto":
      return `<${cls}>`;
    case "env":
      return n.cycle ? "<environment ↺>" : "<environment>";
    default:
      return `<${cls ?? "?"}>`;
  }
}

function typeBadge(n: ObjTreeNode): string | null {
  if (n.type === "s7") return "S7";
  if (n.type === "s4") return "S4";
  if (n.type === "r6") return "R6";
  if (n.type === "ggproto") return "ggproto";
  if (n.type === "env") return "env";
  return null;
}

function TreeNode({ node, name, depth }: { node: ObjTreeNode; name?: string; depth: number }) {
  const hasKids = !!node.children?.length;
  const [open, setOpen] = useState(depth < 1);
  const badge = typeBadge(node);
  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      <div
        className={`flex items-baseline gap-1.5 py-[1px] ${hasKids ? "cursor-pointer" : ""}`}
        onClick={hasKids ? () => setOpen(!open) : undefined}
      >
        <span className="w-3 flex-none text-[10px]" style={{ color: "var(--ink-faint)" }}>
          {hasKids ? (open ? "▾" : "▸") : ""}
        </span>
        {name && (
          <span style={{ color: TYPE_COLORS[node.type ?? ""] ?? "var(--blue)" }}>{name}</span>
        )}
        {badge && <span className="type-badge flex-none">{badge}</span>}
        <span className="truncate" style={{ color: "var(--ink-dim)" }} title={nodeSummary(node)}>
          {nodeSummary(node)}
        </span>
      </div>
      {open && hasKids && (
        <div style={{ borderLeft: "1px solid var(--line)", marginLeft: 5 }}>
          {node.children!.map((c, i) => (
            <TreeNode key={i} node={c} name={c.name} depth={depth + 1} />
          ))}
          {node.truncated && (
            <div className="pl-4" style={{ color: "var(--ink-faint)" }}>
              …
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ObjectTree({ tree }: { tree: ObjTreeNode }) {
  return (
    <div className="mono text-[12px] leading-relaxed">
      {tree.summary && (
        <div
          className="mb-1 px-2 py-1 rounded"
          style={{ background: "var(--blue-soft)", color: "var(--ink)" }}
          title={tree.summaryFull}
        >
          {tree.summaryFull ?? tree.summary}
        </div>
      )}
      <TreeNode node={tree} depth={0} />
    </div>
  );
}
