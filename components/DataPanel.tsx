"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ColInfo, DataDelta, DataWindow, ObjPreview } from "@/lib/webr/types";
import { getActiveEngine } from "@/lib/activeEngine";
import { useT } from "@/lib/i18n";
import ObjectTree from "./ObjectTree";

const ROW_H = 24;
const ROWNO_W = 52;
const COL_W = 110;
const ROW_BATCH = 200;
const COL_BATCH = 40;

export interface DataFocus {
  obj: ObjPreview;
  prev?: ObjPreview | null; // previous step's preview of the same object
  /** paging identity: either an env object at a step, or a pipe store id */
  stepIndex: number; // 1-based R step id
  storeId?: number | null;
  stored: boolean; // step env retained R-side
  title: string;
  /** dataset-semantics diff for pipe steps (rows removed, cols added, reorder…) */
  delta?: DataDelta | null;
}

interface GridState {
  cols: ColInfo[];
  cells: string[][]; // column-major, cells[c][r]
  loadedRows: number;
  loadedCols: number;
}

function initGrid(obj: ObjPreview): GridState {
  const cols = obj.cols ?? [];
  const cells = (obj.cells ?? []).map((c) => [...c]);
  return {
    cols: [...cols],
    cells,
    loadedRows: cells[0]?.length ?? 0,
    loadedCols: cols.length,
  };
}

const NUM_TYPES = new Set(["dbl", "int", "cpl", "num"]);

export default function DataPanel({ focus }: { focus: DataFocus | null }) {
  const t = useT();
  if (!focus) {
    return (
      <div className="flex-1 grid place-items-center p-6 text-center" style={{ color: "var(--ink-faint)" }}>
        {t("noObject")}
      </div>
    );
  }
  const kind = focus.obj.kind;
  if (kind === "data.frame" || kind === "matrix") {
    return <FrameGrid key={`${focus.stepIndex}:${focus.title}:${focus.obj.fp ?? ""}`} focus={focus} />;
  }
  return <ValueView focus={focus} />;
}

/* ── data frame / matrix grid ─────────────────────────────────── */

function FrameGrid({ focus }: { focus: DataFocus }) {
  const t = useT();
  const { obj } = focus;
  const nrow = obj.nrow ?? 0;
  const ncol = obj.ncol ?? 0;
  const [grid, setGrid] = useState<GridState>(() => initGrid(obj));
  const [loading, setLoading] = useState(false);
  const [fromFinal, setFromFinal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const delta = focus.delta;
  const diffSet = useMemo(() => {
    const prev = focus.prev;
    const set = new Set<string>();
    // positional cell diffs are meaningless (all noise) after row
    // removal/addition or a pure reorder — the delta chips carry the story
    if (delta && ((delta.rowDelta ?? 0) !== 0 || delta.reordered)) return set;
    if (!prev || prev.kind !== obj.kind || !prev.cells || !obj.cells) return set;
    const pc = prev.cols ?? [];
    const cc = obj.cols ?? [];
    for (let c = 0; c < Math.min(pc.length, cc.length); c++) {
      if (pc[c].name !== cc[c].name) continue;
      const a = prev.cells[c] ?? [];
      const b = obj.cells[c] ?? [];
      for (let r = 0; r < Math.min(a.length, b.length); r++) {
        if (a[r] !== b[r]) set.add(`${c}:${r}`);
      }
    }
    return set;
  }, [focus.prev, obj]);

  // columns that did not exist in the previous step's version of this object
  const newColSet = useMemo(() => {
    const prev = focus.prev;
    const set = new Set<string>();
    if (!prev?.cols || !obj.cols) return set;
    const old = new Set(prev.cols.map((c) => c.name));
    for (const c of obj.cols) if (!old.has(c.name)) set.add(c.name);
    return set;
  }, [focus.prev, obj]);

  const rowVirt = useVirtualizer({
    count: grid.loadedRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });
  const colVirt = useVirtualizer({
    horizontal: true,
    count: grid.loadedCols,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COL_W,
    overscan: 4,
  });

  const fetchWindow = useCallback(
    async (row0: number, nrows: number, col0: number, ncols: number): Promise<DataWindow | null> => {
      const engine = getActiveEngine();
      try {
        if (focus.storeId != null) return await engine.pipePage(focus.storeId, row0, nrows, col0, ncols);
        return await engine.page(focus.stepIndex, focus.obj.name, row0, nrows, col0, ncols);
      } catch {
        return null;
      }
    },
    [focus],
  );

  const loadMoreRows = useCallback(async () => {
    if (loading || grid.loadedRows >= nrow || grid.loadedRows === 0) return;
    setLoading(true);
    const w = await fetchWindow(grid.loadedRows + 1, ROW_BATCH, 1, grid.loadedCols);
    if (w && w.kind === "window" && w.cells) {
      if (w.source === "final") setFromFinal(!focus.stored && focus.storeId == null);
      setGrid((g) => {
        const cells = g.cells.map((col, c) => [...col, ...(w.cells![c] ?? [])]);
        return { ...g, cells, loadedRows: cells[0]?.length ?? g.loadedRows };
      });
    }
    setLoading(false);
  }, [loading, grid.loadedRows, grid.loadedCols, nrow, fetchWindow, focus]);

  const loadMoreCols = useCallback(async () => {
    if (loading || grid.loadedCols >= ncol) return;
    setLoading(true);
    const w = await fetchWindow(1, Math.max(grid.loadedRows, 1), grid.loadedCols + 1, COL_BATCH);
    if (w && w.kind === "window" && w.cells && w.cols) {
      if (w.source === "final") setFromFinal(!focus.stored && focus.storeId == null);
      setGrid((g) => ({
        cols: [...g.cols, ...w.cols!],
        cells: [...g.cells, ...w.cells!.map((c) => c.slice(0, g.loadedRows))],
        loadedRows: g.loadedRows,
        loadedCols: g.loadedCols + w.cols!.length,
      }));
    }
    setLoading(false);
  }, [loading, grid.loadedCols, grid.loadedRows, ncol, fetchWindow, focus]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 6) void loadMoreRows();
  }, [loadMoreRows]);

  const totalW = ROWNO_W + colVirt.getTotalSize();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-xs flex-none flex-wrap"
        style={{ borderBottom: "1px solid var(--line)", color: "var(--ink-dim)" }}
      >
        <span className="mono font-semibold" style={{ color: "var(--blue)" }}>
          {focus.title}
        </span>
        <span className="chip mono">
          {nrow.toLocaleString()} × {ncol.toLocaleString()}
        </span>
        {obj.cls && <span className="chip mono">{(Array.isArray(obj.cls) ? obj.cls[0] : obj.cls)}</span>}
        {grid.loadedRows < nrow && (
          <span>
            {t("showingRows")} {grid.loadedRows.toLocaleString()}
          </span>
        )}
        {grid.loadedCols < ncol && (
          <button className="btn btn-icon text-xs" onClick={loadMoreCols} disabled={loading}>
            {t("loadMoreCols")} ({ncol - grid.loadedCols})
          </button>
        )}
        {fromFinal && <span style={{ color: "var(--chg)" }}>· {t("finalStateNote")}</span>}
        {loading && <span className="animate-pulse">…</span>}
        {delta && (
          <>
            {(delta.rowDelta ?? 0) !== 0 && (
              <span className="chip mono" style={{ color: (delta.rowDelta ?? 0) < 0 ? "var(--del)" : "var(--add)", borderColor: "currentcolor" }}>
                {(delta.rowDelta ?? 0) > 0 ? "+" : "−"}{Math.abs(delta.rowDelta ?? 0)} rows
              </span>
            )}
            {!!delta.groups?.length && (
              <span className="chip mono" style={{ color: "var(--blue)", borderColor: "currentcolor" }}>
                ⊞ grouped: {delta.groups.join(", ")}
              </span>
            )}
            {delta.reordered && (
              <span className="chip mono" style={{ color: "var(--blue)", borderColor: "currentcolor" }}>↕ reorder</span>
            )}
            {(delta.colsAdded ?? []).map((c) => (
              <span key={`a${c}`} className="chip mono" style={{ color: "var(--add)", borderColor: "currentcolor" }}>+ {c}</span>
            ))}
            {(delta.colsRemoved ?? []).map((c) => (
              <span key={`r${c}`} className="chip mono" style={{ color: "var(--del)", borderColor: "currentcolor" }}>− {c}</span>
            ))}
            {(delta.colsChanged ?? []).map((c) => (
              <span key={`c${c}`} className="chip mono" style={{ color: "var(--chg)", borderColor: "currentcolor" }}>~ {c}</span>
            ))}
            {(delta.colsRetyped ?? []).map((rt) => (
              <span key={`t${rt.col}`} className="chip mono" style={{ color: "var(--blue)", borderColor: "currentcolor" }}>
                {rt.col}: {rt.from}→{rt.to}
              </span>
            ))}
            {(delta.naIntro ?? []).map((na) => (
              <span key={`n${na.col}`} className="chip mono" style={{ color: "var(--del)", borderColor: "var(--chg)" }}>
                ⚠ {na.col}: +{na.n} NA
              </span>
            ))}
          </>
        )}
      </div>
      {!!delta?.removedSample?.length && (
        <div
          className="px-3 py-1 mono text-[11px] flex-none"
          style={{ background: "var(--del-soft)", color: "var(--del)", borderBottom: "1px solid var(--line)" }}
        >
          {t("removedRows")} ({delta.rowsRemovedExact ?? Math.abs(delta.rowDelta ?? 0)}):{" "}
          {delta.removedSample.map((r, i) => (
            <span key={i} className="line-through opacity-80 mr-3">{r}</span>
          ))}
          {(delta.rowsRemovedExact ?? 0) > delta.removedSample.length ? "…" : ""}
        </div>
      )}
      {nrow === 0 || ncol === 0 ? (
        <div className="flex-1 grid place-items-center" style={{ color: "var(--ink-faint)" }}>
          {t("emptyDf")} ({nrow} × {ncol})
        </div>
      ) : (
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto dgrid min-h-0">
          <div style={{ width: totalW, height: rowVirt.getTotalSize() + ROW_H, position: "relative" }}>
            {/* header row */}
            <div
              style={{
                position: "sticky", top: 0, zIndex: 3, height: ROW_H,
                width: totalW, background: "var(--panel-2)",
              }}
            >
              <div
                className="dgrid-cell dgrid-rowno"
                style={{ position: "sticky", left: 0, width: ROWNO_W, height: ROW_H, zIndex: 4, display: "inline-block" }}
              >
                #
              </div>
              {colVirt.getVirtualItems().map((vc) => {
                const col = grid.cols[vc.index];
                const isNew = col && newColSet.has(col.name);
                const isChg = col && !isNew && delta?.colsChanged?.includes(col.name);
                return (
                  <div
                    key={vc.key}
                    className="dgrid-cell dgrid-head"
                    style={{
                      position: "absolute", left: ROWNO_W + vc.start, width: vc.size, height: ROW_H, top: 0,
                      ...(isNew ? { background: "var(--add-soft)", color: "var(--add)" } : {}),
                      ...(isChg ? { background: "var(--chg-soft)", color: "var(--chg)" } : {}),
                    }}
                    title={col?.name}
                  >
                    <span className="truncate">{col?.name}</span>
                    <span className="type-badge">{col?.type}</span>
                  </div>
                );
              })}
            </div>
            {/* body */}
            {rowVirt.getVirtualItems().map((vr) => (
              <div key={vr.key} style={{ position: "absolute", top: vr.start + ROW_H, left: 0, height: vr.size, width: totalW }}>
                <div
                  className="dgrid-cell dgrid-rowno"
                  style={{ position: "sticky", left: 0, width: ROWNO_W, height: ROW_H, zIndex: 2, display: "block" }}
                >
                  {vr.index + 1}
                </div>
                {colVirt.getVirtualItems().map((vc) => {
                  const val = grid.cells[vc.index]?.[vr.index];
                  const isNum = NUM_TYPES.has(grid.cols[vc.index]?.type ?? "");
                  const changed = diffSet.has(`${vc.index}:${vr.index}`);
                  return (
                    <div
                      key={vc.key}
                      className={`dgrid-cell${isNum ? " num" : ""}${val === "NA" ? " na" : ""}${changed ? " diff" : ""}`}
                      style={{
                        position: "absolute", left: ROWNO_W + vc.start, width: vc.size,
                        height: ROW_H, top: 0,
                      }}
                      title={val}
                    >
                      {val ?? ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── non-tabular values ───────────────────────────────────────── */

function ValueView({ focus }: { focus: DataFocus }) {
  const t = useT();
  const o = focus.obj;
  return (
    <div className="flex-1 overflow-auto p-3 mono text-[13px] leading-relaxed">
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <span className="font-semibold" style={{ color: "var(--blue)" }}>{focus.title}</span>
        {o.cls && <span className="chip">{Array.isArray(o.cls) ? o.cls.join(", ") : o.cls}</span>}
      </div>
      {o.kind === "vector" && (
        <VectorView values={o.values ?? []} names={o.names} length={o.length ?? 0} vtype={o.vtype} />
      )}
      {o.kind === "factor" && (
        <>
          <VectorView values={o.values ?? []} length={o.length ?? 0} vtype="fct" />
          <div className="mt-2" style={{ color: "var(--ink-dim)" }}>
            {o.nlevels} {t("levels")}: {(o.levels ?? []).join(", ")}
            {(o.nlevels ?? 0) > (o.levels?.length ?? 0) ? "…" : ""}
          </div>
        </>
      )}
      {o.kind === "list" && (
        <table className="w-full text-left">
          <tbody>
            {(o.items ?? []).map((it, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                <td className="py-1 pr-3" style={{ color: "var(--blue)" }}>${it.name}</td>
                <td className="py-1 pr-3"><span className="type-badge">{it.cls}</span></td>
                <td className="py-1" style={{ color: "var(--ink-dim)" }}>[{it.length}]</td>
              </tr>
            ))}
            {(o.length ?? 0) > (o.items?.length ?? 0) && (
              <tr><td className="py-1" style={{ color: "var(--ink-faint)" }}>… {(o.length ?? 0) - (o.items?.length ?? 0)} more</td></tr>
            )}
          </tbody>
        </table>
      )}
      {o.kind === "function" && <pre style={{ color: "var(--ink-dim)" }}>{o.args}</pre>}
      {o.kind === "null" && <span style={{ color: "var(--ink-faint)" }}>NULL</span>}
      {o.kind === "object" && o.tree && <ObjectTree tree={o.tree} />}
      {o.kind === "other" && (
        <pre className="whitespace-pre-wrap" style={{ color: "var(--ink-dim)" }}>
          {Array.isArray(o.print) ? o.print.join("\n") : o.print}
        </pre>
      )}
    </div>
  );
}

function VectorView({
  values, names, length, vtype,
}: { values: string[]; names?: string[]; length: number; vtype?: string }) {
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {values.map((v, i) => (
          <span
            key={i}
            className="inline-flex flex-col items-center px-2 py-0.5 rounded"
            style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}
            title={names?.[i]}
          >
            {names?.[i] && (
              <span className="text-[10px]" style={{ color: "var(--ink-faint)" }}>{names[i]}</span>
            )}
            <span className={v === "NA" ? "na" : ""} style={v === "NA" ? { color: "var(--ink-faint)", fontStyle: "italic" } : undefined}>
              {v}
            </span>
          </span>
        ))}
        {length > values.length && (
          <span className="px-2 py-0.5" style={{ color: "var(--ink-faint)" }}>
            … {length - values.length} more
          </span>
        )}
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--ink-faint)" }}>
        {vtype} · length {length}
      </div>
    </div>
  );
}
