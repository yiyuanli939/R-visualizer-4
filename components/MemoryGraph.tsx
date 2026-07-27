"use client";

import { useMemo } from "react";
import type { EnvSnapshot, ObjPreview, ObjTreeNode } from "@/lib/webr/types";

/**
 * Python-Tutor-style memory diagram, in a graphical language designed for R:
 *  - boxes are objects; the header strip names the class + object system
 *    (S7 / S4 / R6 / env / ggproto badges)
 *  - VALUE semantics (R's copy-on-write) = nesting: plain values render
 *    inside their owner's box
 *  - REFERENCE semantics = arrows: environments and R6 objects live once in
 *    the heap column; every name bound to the same object points one arrow
 *    at the same box (shared refId)
 *  - vectors are typed cell strips, data frames are grid badges,
 *    functions are signature boxes
 *  - green border = added this step, amber = changed
 */

const ROW = 17;
const SLOT_W = 108;
const VAL_X = 158;
const VAL_W = 240;
const HEAP_X = 428;
const HEAP_W = 250;
const GAP = 12;

const SYS_COLOR: Record<string, string> = {
  s7: "#9a6ee0",
  s4: "var(--accent)",
  r6: "var(--del)",
  env: "var(--chg)",
  ggproto: "var(--ink-faint)",
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string; // header label
  sysType?: string;
  rows: { label: string; value: string; arrowTo?: string }[]; // arrowTo = refId
  cells?: { v: string; vtype?: string }[]; // vector strip
  note?: string;
  border: string;
  refId?: string;
}

interface Arrow {
  x1: number; y1: number; toRef: string;
}

function clsOf(o: { cls?: string[] | string }): string {
  return (Array.isArray(o.cls) ? o.cls[0] : o.cls) ?? "?";
}

function nodeInline(n: ObjTreeNode): string {
  if (n.type === "atomic") {
    const vals = (n.preview as string[] | undefined)?.slice(0, 3).join(", ") ?? "";
    return n.n === 1 ? vals : `${n.vtype ?? ""}[${n.n}] ${vals}${(n.n ?? 0) > 3 ? "…" : ""}`;
  }
  if (n.type === "df" || n.type === "matrix") return `${clsOf(n)} ${n.dims ?? ""}`;
  if (n.type === "factor") return `factor ${n.dims ?? ""}`;
  if (n.type === "function") return "ƒ " + (n.sig ?? "").replace(/^function\s*/, "").slice(0, 24);
  if (n.type === "list") return `list(${n.n ?? 0})`;
  if (n.type === "null") return "NULL";
  return `<${clsOf(n)}>`;
}

function buildObjectRows(tree: ObjTreeNode): Box["rows"] {
  return (tree.children ?? []).slice(0, 10).map((c) => ({
    label: c.name,
    value: c.refId ? "" : nodeInline(c),
    arrowTo: c.refId,
  }));
}

function boxFor(o: ObjPreview, border: string): Omit<Box, "x" | "y"> {
  if (o.kind === "vector" || o.kind === "factor") {
    const cells = (o.values ?? []).slice(0, 5).map((v) => ({ v, vtype: o.vtype }));
    if ((o.length ?? 0) > 5) cells.push({ v: `…${o.length}`, vtype: o.vtype });
    return {
      w: Math.max(120, Math.min(VAL_W, 16 + cells.length * 44)), h: 44,
      kind: o.kind === "factor" ? `factor · ${o.nlevels} levels` : `${o.vtype ?? "vector"}[${o.length}]`,
      rows: [], cells, border,
    };
  }
  if (o.kind === "data.frame" || o.kind === "matrix") {
    const schema = (o.cols ?? []).slice(0, 4).map((c) => `${c.name}<${c.type}>`).join(" ");
    return {
      w: VAL_W, h: 44, kind: `${clsOf(o)} ${o.nrow}×${o.ncol}`,
      rows: [{ label: "", value: schema + ((o.cols?.length ?? 0) > 4 ? " …" : "") }],
      border, note: "grid",
    };
  }
  if (o.kind === "function") {
    return {
      w: VAL_W, h: 34, kind: "function",
      rows: [{ label: "ƒ", value: (o.args ?? "").replace(/^function\s*/, "").slice(0, 30) }],
      border,
    };
  }
  if (o.kind === "object" && o.tree) {
    const t = o.tree;
    const rows = buildObjectRows(t);
    return {
      w: VAL_W, h: 22 + Math.max(1, rows.length) * ROW + 4,
      kind: clsOf(t), sysType: t.type, rows, border, refId: t.refId,
      note: t.summary,
    };
  }
  return {
    w: VAL_W, h: 34, kind: clsOf(o),
    rows: [{ label: "", value: o.summary ?? "" }], border,
  };
}

export default function MemoryGraph({
  env, onSelectVar, emptyText, stepKey = 0,
}: {
  env: EnvSnapshot | null;
  onSelectVar?: (name: string) => void;
  emptyText?: string;
  /** changes per step so changed-box pulse animations restart */
  stepKey?: number;
}) {
  const model = useMemo(() => {
    if (!env) return null;
    const added = new Set(env.added);
    const changed = new Set(env.changed);
    const slots: { name: string; y: number; border: string; arrowTo?: string }[] = [];
    const boxes: Box[] = [];
    const arrows: Arrow[] = [];
    const heap = new Map<string, Box>(); // refId -> box
    let y = 26;
    let heapY = 26;

    const heapBoxFor = (refId: string, tree: ObjTreeNode | undefined, border: string): Box => {
      let hb = heap.get(refId);
      if (hb) return hb;
      const rows = tree ? buildObjectRows(tree) : [];
      hb = {
        x: HEAP_X, y: heapY, w: HEAP_W,
        h: 22 + Math.max(1, rows.length) * ROW + 4,
        kind: tree ? clsOf(tree) : "environment",
        sysType: tree?.type ?? "env",
        rows, border, refId,
      };
      heap.set(refId, hb);
      boxes.push(hb);
      heapY += hb.h + GAP;
      // reference-typed members of heap objects can themselves point onward
      rows.forEach((r, i) => {
        if (r.arrowTo) arrows.push({ x1: HEAP_X + HEAP_W - 6, y1: hb!.y + 22 + i * ROW + 8, toRef: r.arrowTo });
      });
      return hb;
    };

    for (const o of env.objs) {
      const border = added.has(o.name)
        ? "var(--add)"
        : changed.has(o.name)
          ? "var(--chg)"
          : "var(--line)";
      const isRef = o.kind === "object" && !!o.tree?.refId && (o.tree.type === "env" || o.tree.type === "r6");
      if (isRef) {
        const refId = o.tree!.refId!;
        heapBoxFor(refId, o.tree!, border);
        slots.push({ name: o.name, y, border, arrowTo: refId });
        y += 30;
      } else {
        const spec = boxFor(o, border);
        const b: Box = { ...spec, x: VAL_X, y };
        boxes.push(b);
        slots.push({ name: o.name, y, border });
        // nested reference members (e.g. a list holding an env)
        b.rows.forEach((r, i) => {
          if (r.arrowTo) {
            heapBoxFor(r.arrowTo, undefined, "var(--line)");
            arrows.push({ x1: b.x + b.w - 6, y1: b.y + 22 + i * ROW + 8, toRef: r.arrowTo });
          }
        });
        y += b.h + GAP;
      }
    }
    // removed ghosts
    for (const name of env.removed) {
      slots.push({ name: `✕ ${name}`, y, border: "var(--del)" });
      y += 26;
    }
    const height = Math.max(y, heapY) + 10;
    return { slots, boxes, arrows, heap, height };
  }, [env]);

  if (!model || (!model.slots.length && !model.boxes.length)) {
    return (
      <div className="flex-1 grid place-items-center p-4 text-center" style={{ color: "var(--ink-faint)" }}>
        {emptyText ?? "—"}
      </div>
    );
  }

  const W = HEAP_X + HEAP_W + 20;
  return (
    <div className="flex-1 overflow-auto p-2">
      <svg
        key={stepKey}
        width={W}
        height={model.height}
        viewBox={`0 0 ${W} ${model.height}`}
        className="mono"
        style={{ fontFamily: "var(--font-plex-mono), monospace", fontSize: 11 }}
      >
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0.5 L7,4 L0,7.5" fill="none" stroke="var(--blue)" strokeWidth="1.4" />
          </marker>
        </defs>

        {/* workspace frame */}
        <text x={10} y={14} fill="var(--ink-faint)" fontSize={9.5} letterSpacing={1}>
          WORKSPACE
        </text>
        {model.slots.map((s, i) => (
          <g
            key={i}
            style={onSelectVar && !s.name.startsWith("✕") ? { cursor: "pointer" } : undefined}
            onClick={onSelectVar && !s.name.startsWith("✕") ? () => onSelectVar(s.name) : undefined}
          >
            <title>{s.name}</title>
            <rect x={8} y={s.y + 6} width={SLOT_W} height={22} rx={5}
              fill="var(--panel-2)" stroke={s.border} strokeWidth={s.border === "var(--line)" ? 1 : 1.6} />
            <text x={16} y={s.y + 21} fill="var(--ink)" fontWeight={600}>
              {s.name.length > 11 ? s.name.slice(0, 10) + "…" : s.name}
            </text>
            {s.arrowTo && model.heap.get(s.arrowTo) && (
              <path
                d={`M ${8 + SLOT_W} ${s.y + 17} C ${8 + SLOT_W + 60} ${s.y + 17}, ${HEAP_X - 70} ${model.heap.get(s.arrowTo)!.y + 12}, ${HEAP_X - 3} ${model.heap.get(s.arrowTo)!.y + 12}`}
                fill="none" stroke="var(--blue)" strokeWidth={1.4} markerEnd="url(#arr)"
              />
            )}
            {!s.arrowTo && !s.name.startsWith("✕") && (
              <line x1={8 + SLOT_W} y1={s.y + 17} x2={VAL_X - 3} y2={s.y + 17}
                stroke="var(--blue)" strokeWidth={1.4} markerEnd="url(#arr)" />
            )}
          </g>
        ))}

        {/* heap divider */}
        <line x1={HEAP_X - 14} y1={4} x2={HEAP_X - 14} y2={model.height - 4}
          stroke="var(--line)" strokeDasharray="3 4" />
        <text x={HEAP_X} y={14} fill="var(--ink-faint)" fontSize={9.5} letterSpacing={1}>
          HEAP · reference objects
        </text>

        {/* member-to-heap arrows */}
        {model.arrows.map((a, i) => {
          const hb = model.heap.get(a.toRef);
          if (!hb) return null;
          return (
            <path key={i}
              d={`M ${a.x1} ${a.y1} C ${a.x1 + 50} ${a.y1}, ${hb.x - 50} ${hb.y + 12}, ${hb.x - 3} ${hb.y + 12}`}
              fill="none" stroke="var(--blue)" strokeWidth={1.2} markerEnd="url(#arr)" opacity={0.8}
            />
          );
        })}

        {/* object boxes */}
        {model.boxes.map((b, i) => {
          const sysColor = b.sysType ? SYS_COLOR[b.sysType] : undefined;
          return (
            <g key={i}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={7}
                className={b.border !== "var(--line)" ? "mem-pulse" : undefined}
                fill="var(--panel)" stroke={b.border} strokeWidth={b.border === "var(--line)" ? 1 : 1.8} />
              {/* header strip */}
              <rect x={b.x} y={b.y} width={b.w} height={18} rx={7} fill="var(--panel-2)" />
              <rect x={b.x} y={b.y + 10} width={b.w} height={8} fill="var(--panel-2)" />
              <text x={b.x + 8} y={b.y + 13} fill="var(--ink-dim)" fontSize={10.5} fontWeight={600}>
                {b.kind.length > 26 ? b.kind.slice(0, 25) + "…" : b.kind}
              </text>
              {b.sysType && SYS_COLOR[b.sysType] && (
                <>
                  <rect x={b.x + b.w - 40} y={b.y + 3} width={34} height={13} rx={3}
                    fill="none" stroke={sysColor} strokeWidth={1} />
                  <text x={b.x + b.w - 23} y={b.y + 13} textAnchor="middle" fill={sysColor} fontSize={9} fontWeight={700}>
                    {b.sysType === "ggproto" ? "ggp" : b.sysType.toUpperCase()}
                  </text>
                </>
              )}
              {/* vector cell strip (cells sized to fit the box) */}
              {b.cells?.map((c, j) => {
                const cw = (b.w - 16) / b.cells!.length;
                const cx = b.x + 8 + j * cw;
                return (
                  <g key={j}>
                    <rect x={cx} y={b.y + 24} width={cw - 2} height={15}
                      fill="var(--blue-soft)" stroke="var(--line)" strokeWidth={0.6}>
                      <title>{c.v}</title>
                    </rect>
                    <text x={cx + (cw - 2) / 2} y={b.y + 35} textAnchor="middle" fill="var(--ink)" fontSize={9.5}>
                      {c.v.length > 6 ? c.v.slice(0, 5) + "…" : c.v}
                    </text>
                    <text x={cx + (cw - 2) / 2} y={b.y + 22} textAnchor="middle" fill="var(--ink-faint)" fontSize={7.5}>
                      {j + 1}
                    </text>
                  </g>
                );
              })}
              {/* record rows */}
              {b.rows.map((r, j) => (
                <text key={j} x={b.x + 8} y={b.y + 22 + j * ROW + 11} fontSize={10.5}>
                  <title>{r.label ? `${r.label}: ${r.value}` : r.value}</title>
                  <tspan fill={b.sysType ? (SYS_COLOR[b.sysType] ?? "var(--blue)") : "var(--blue)"}>{r.label}</tspan>
                  <tspan fill="var(--ink)" dx={r.label ? 6 : 0}>
                    {r.arrowTo ? "→" : r.value.length > 24 ? r.value.slice(0, 23) + "…" : r.value}
                  </tspan>
                </text>
              ))}
              {b.note && (
                <title>{b.note}</title>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
