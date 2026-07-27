"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LangProvider, useLang, useT } from "@/lib/i18n";
import { EXAMPLES } from "@/lib/examples";
import { type UploadedFile } from "@/lib/webr/engine";
import { getActiveEngine, setBackend, type Backend } from "@/lib/activeEngine";
import { getLocalEngine } from "@/lib/localEngine";
import type { EngineStatus, ObjPreview, RunResult, TraceStep } from "@/lib/webr/types";
import StepControls from "@/components/StepControls";
import PipelineRail from "@/components/PipelineRail";
import DataPanel, { type DataFocus } from "@/components/DataPanel";
import VariablesPanel from "@/components/VariablesPanel";
import ConsolePanel from "@/components/ConsolePanel";
import PlotsPanel from "@/components/PlotsPanel";
import FilesPanel from "@/components/FilesPanel";
import ExplainBar from "@/components/ExplainBar";
import OutlinePanel from "@/components/OutlinePanel";
import InspectorPopover, { type InspectorState } from "@/components/InspectorPopover";
import MemoryGraph from "@/components/MemoryGraph";
import DeltaBar from "@/components/DeltaBar";
import LocalGuide from "@/components/LocalGuide";
import { buildOutline } from "@/lib/outline";
import { smallestEnclosingSpan, spanText } from "@/lib/spans";
import type { EditorSelection } from "@/components/Editor";

const Editor = dynamic(() => import("@/components/Editor"), { ssr: false });

const DF_KINDS = new Set(["data.frame", "matrix"]);

export default function Page() {
  return (
    <LangProvider>
      <App />
    </LangProvider>
  );
}

function App() {
  const t = useT();
  const { lang, setLang } = useLang();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [code, setCode] = useState(EXAMPLES[0].code);
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id);
  const [stepLoops, setStepLoops] = useState(true);
  const [continueOnError, setContinueOnError] = useState(true);
  const [keepWorkspace, setKeepWorkspace] = useState(false);
  const [maxSteps, setMaxSteps] = useState(1000);
  const [backend, setBackendState] = useState<Backend>("webr");
  const [tokenInput, setTokenInput] = useState("");
  const [inspector, setInspector] = useState<InspectorState | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const inspectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspectSeq = useRef(0);
  const [status, setStatus] = useState<EngineStatus>({ phase: "unloaded" });
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState<{ name: string; at: number } | null>(null);
  const [bottomTab, setBottomTab] = useState<"memory" | "variables" | "console" | "plots" | "outline">("memory");
  const [splitX, setSplitX] = useState(44); // editor column % width
  const [splitY, setSplitY] = useState(58); // data area % height
  const runningRef = useRef(false);
  const lastFocusRef = useRef<string | null>(null);

  // theme init from <html data-theme> (set pre-hydration in layout)
  useEffect(() => {
    const cur = document.documentElement.dataset.theme;
    if (cur === "light" || cur === "dark") setTheme(cur);
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("rviz-theme", next);
      return next;
    });
  }, []);

  // engine status + files subscription; boot the active engine
  useEffect(() => {
    const engine = getActiveEngine();
    const unsub = engine.subscribe((s) => {
      setStatus({ ...s });
      setFiles([...engine.files]);
    });
    void engine.init().catch(() => {});
    return unsub;
  }, [backend]);

  const steps: TraceStep[] = useMemo(() => result?.steps ?? [], [result]);
  const step = steps[stepIdx] as TraceStep | undefined;

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const res = await getActiveEngine().runTrace(code, stepLoops, { continueOnError, maxSteps, keepWorkspace });
      setResult(res);
      setStale(false);
      setSelected(null);
      lastFocusRef.current = null;
      setStepIdx(0);
      if (!res.ok) setBottomTab("console");
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        truncated: false, nPlots: 0, envStored: false, steps: [], plotUrls: [],
      });
      setBottomTab("console");
    } finally {
      runningRef.current = false;
    }
  }, [code, stepLoops, continueOnError, maxSteps, keepWorkspace]);

  // dev-only hook so tests can load code into the editor programmatically
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as Record<string, unknown>).__loadCode = (c: string) => {
      setCode(c);
      setStale(true);
    };
  }, []);

  // select-to-inspect: map the selection to the smallest enclosing expression
  // (R parse data), then evaluate it in that step's environment (+data mask)
  const onEditorSelect = useCallback(
    (sel: EditorSelection | null) => {
      if (inspectTimer.current) clearTimeout(inspectTimer.current);
      if (!sel || !result || stale || !steps.length) {
        return; // keep an open popover; explicit close via Esc/click-away
      }
      inspectTimer.current = setTimeout(() => {
        const seq = ++inspectSeq.current;
        const lines = code.split("\n");
        const span = result.parseSpans
          ? smallestEnclosingSpan(result.parseSpans, sel)
          : null;
        const src = (span ? spanText(lines, span) : sel.text).trim();
        if (!src) return;
        const st = steps[stepIdx];
        setInspector({ src, coords: sel.coords, loading: true });
        void getActiveEngine()
          .inspect(st?.i ?? 1, src, st?.pipe?.storeId ?? null)
          .then((res) => {
            if (inspectSeq.current === seq) setInspector({ src, coords: sel.coords, loading: false, result: res });
          })
          .catch((e) => {
            if (inspectSeq.current === seq)
              setInspector({
                src, coords: sel.coords, loading: false,
                result: { ok: false, source: src, error: e instanceof Error ? e.message : String(e) },
              });
          });
      }, 350);
    },
    [result, stale, steps, stepIdx, code],
  );

  const jumpToNextError = useCallback(() => {
    if (!steps.length) return;
    const start = stepIdx + 1;
    for (let k = 0; k < steps.length; k++) {
      const i = (start + k) % steps.length;
      if (steps[i].errorMsg) {
        setStepIdx(i);
        return;
      }
    }
  }, [steps, stepIdx]);

  const onCodeChange = useCallback((c: string) => {
    setCode(c);
    setStale(true);
  }, []);

  const loadExample = useCallback((id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setExampleId(id);
    setCode(ex.code);
    setStale(true);
  }, []);

  const onCodeFile = useCallback((name: string, content: string) => {
    setCode(content);
    setStale(true);
  }, []);

  // keyboard stepping
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!steps.length) return;
      const el = e.target as HTMLElement;
      if (el.closest?.(".cm-editor") || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const max = steps.length - 1;
      if (e.key === "ArrowLeft") setStepIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setStepIdx((i) => Math.min(max, i + 1));
      else if (e.key === "Home") setStepIdx(0);
      else if (e.key === "End") setStepIdx(max);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);

  // current focus for the data panel
  const focus: DataFocus | null = useMemo(() => {
    if (!step) return null;
    const findObj = (st: TraceStep | undefined, name: string): ObjPreview | null =>
      st?.env.objs.find((o) => o.name === name) ?? null;

    const userPick = selected && selected.at === stepIdx ? selected.name : null;

    if (step.pipe?.value && !userPick) {
      const prevStep = steps[stepIdx - 1];
      const prevVal = step.pipe.index > 1 && prevStep?.pipe ? prevStep.pipe.value : null;
      return {
        obj: step.pipe.value,
        prev: prevVal ?? null,
        stepIndex: step.i,
        storeId: step.pipe.storeId ?? null,
        stored: false,
        title: `${t("pipeResult")} · ${step.pipe.label}`,
        delta: step.pipe.delta ?? null,
      };
    }

    let name: string | null = null;
    if (userPick && findObj(step, userPick)) name = userPick;
    else if (selected && !step.pipe && findObj(step, selected.name)) name = selected.name;
    if (!name) {
      const touched = [...step.env.changed, ...step.env.added].reverse();
      name =
        touched.find((n) => DF_KINDS.has(findObj(step, n)?.kind ?? "")) ??
        touched[0] ??
        null;
    }
    if (!name && lastFocusRef.current && findObj(step, lastFocusRef.current)) name = lastFocusRef.current;
    if (!name) {
      const firstDf = step.env.objs.find((o) => DF_KINDS.has(o.kind ?? ""));
      name = firstDf?.name ?? step.env.objs[0]?.name ?? null;
    }
    if (!name) return null;
    lastFocusRef.current = name;
    const obj = findObj(step, name);
    if (!obj) return null;
    const prevObj = stepIdx > 0 ? findObj(steps[stepIdx - 1], name) : null;
    return {
      obj,
      prev: prevObj,
      stepIndex: step.i,
      storeId: null,
      stored: step.env.stored,
      title: name,
      delta: obj.delta ?? null,
    };
  }, [step, stepIdx, steps, selected, t]);

  const outline = useMemo(
    () => (steps.length && !stale ? buildOutline(code, steps, lang) : []),
    [code, steps, stale, lang],
  );
  const sectionTitle = useMemo(() => {
    const c = outline.find((ch) => ch.stepIdxs.includes(stepIdx));
    return c?.fromComment ? c.title : null;
  }, [outline, stepIdx]);

  const busy = status.phase === "running";
  const ready = status.phase === "ready";
  const plotCount = useMemo(() => {
    const seen = new Set<number>();
    for (let i = 0; i <= stepIdx && i < steps.length; i++) steps[i].plots.forEach((p) => seen.add(p));
    return seen.size;
  }, [steps, stepIdx]);

  const statusLabel =
    status.phase === "ready" && status.detail
      ? status.detail
      : t(`st.${status.phase}` as Parameters<typeof t>[0]);

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg)" }}>
      {/* ── top bar ── */}
      <header
        className="flex items-center gap-3 px-4 py-2 flex-none flex-wrap"
        style={{ borderBottom: "1px solid var(--line)", background: "var(--panel)" }}
      >
        <h1 className="mono text-[15px] font-semibold select-none whitespace-nowrap">
          <span style={{ color: "var(--ink-dim)" }}>code</span>
          <span style={{ color: "var(--accent)" }}> |&gt; </span>
          <span style={{ color: "var(--blue)" }}>viz()</span>
        </h1>
        <span className="text-xs hidden xl:block" style={{ color: "var(--ink-faint)" }}>
          {t("tagline")}
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select
            className="btn cursor-pointer"
            value={exampleId}
            onChange={(e) => loadExample(e.target.value)}
            aria-label={t("examples")}
          >
            {EXAMPLES.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name[lang]}
              </option>
            ))}
          </select>
          <select
            className="btn cursor-pointer"
            value={backend}
            aria-label="Engine"
            onChange={(e) => {
              const b = e.target.value as Backend;
              setBackend(b);
              setBackendState(b);
              setStale(true);
              setResult(null);
            }}
          >
            <option value="webr">{t("backendWebR")}</option>
            <option value="local">{t("backendLocal")}</option>
          </select>
          <button
            className="btn btn-icon"
            title={t("localGuide")}
            onClick={() => setShowGuide(true)}
          >
            ?
          </button>
          <details className="opts">
            <summary>
              <span className="btn btn-icon" title={t("runOptions")} aria-label={t("runOptions")}>
                ⚙
              </span>
            </summary>
            <div className="opts-panel">
              <label>
                <input
                  type="checkbox"
                  checked={stepLoops}
                  onChange={(e) => {
                    setStepLoops(e.target.checked);
                    setStale(true);
                  }}
                  style={{ accentColor: "var(--accent)" }}
                />
                {t("stepLoops")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={continueOnError}
                  onChange={(e) => {
                    setContinueOnError(e.target.checked);
                    setStale(true);
                  }}
                  style={{ accentColor: "var(--accent)" }}
                />
                {t("continueOnError")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={keepWorkspace}
                  onChange={(e) => setKeepWorkspace(e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                />
                {t("keepWorkspace")}
              </label>
              <label>
                {t("maxSteps")}
                <select
                  value={maxSteps}
                  onChange={(e) => {
                    setMaxSteps(Number(e.target.value));
                    setStale(true);
                  }}
                >
                  {[1000, 2000, 5000].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <button
            className="btn btn-icon"
            onClick={() => setLang(lang === "en" ? "zh" : "en")}
            title="Language / 语言"
          >
            {lang === "en" ? "中" : "EN"}
          </button>
          <button className="btn btn-icon" onClick={toggleTheme} title={t("theme")}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          {busy ? (
            <button className="btn" onClick={() => getActiveEngine().interrupt()}>
              ■ {t("stop")}
            </button>
          ) : (
            <button className="btn btn-run" onClick={() => void run()} disabled={!ready}>
              ▶ {t("run")}
            </button>
          )}
        </div>
      </header>

      {/* ── status strip ── */}
      <div
        className="flex items-center gap-2 px-4 py-1 text-xs flex-none overflow-x-auto"
        style={{ color: "var(--ink-dim)", background: "var(--panel)", borderBottom: "1px solid var(--line)" }}
      >
        <span
          className={`inline-block w-2 h-2 rounded-full flex-none ${busy || ["downloading", "packages", "starting"].includes(status.phase) ? "animate-pulse" : ""}`}
          style={{
            background:
              status.phase === "ready" ? "var(--add)" :
              status.phase === "error" ? "var(--del)" : "var(--chg)",
          }}
        />
        <span className="whitespace-nowrap">{statusLabel}</span>
        {busy && status.detail && (
          <span className="whitespace-nowrap" style={{ color: "var(--ink-faint)" }}>· {status.detail}</span>
        )}
        {status.phase === "error" && backend !== "local" && (
          <span style={{ color: "var(--del)" }}>{status.detail}</span>
        )}
        {status.phase === "error" && backend === "local" && status.authRequired && (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="whitespace-nowrap" style={{ color: "var(--chg)" }}>{t("tokenPrompt")}</span>
            <input
              className="mono rounded px-2 py-0.5"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)", width: 220 }}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") getLocalEngine().setToken(tokenInput);
              }}
              spellCheck={false}
            />
            <button className="btn btn-icon" onClick={() => getLocalEngine().setToken(tokenInput)}>
              {t("tokenApply")}
            </button>
          </span>
        )}
        {status.phase === "error" && backend === "local" && !status.authRequired && (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="whitespace-nowrap" style={{ color: "var(--del)" }}>{t("localStart")}</span>
            <code
              className="mono chip select-all"
              style={{ color: "var(--ink)", maxWidth: 460, overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {`Rscript -e 'source("${typeof location !== "undefined" ? location.origin : ""}/rviz-local.R")'`}
            </code>
            <button
              className="btn btn-icon"
              title={t("copied")}
              onClick={() =>
                navigator.clipboard.writeText(
                  `Rscript -e 'source("${location.origin}/rviz-local.R")'`,
                )
              }
            >
              ⧉
            </button>
            <button className="btn btn-icon" onClick={() => void getActiveEngine().init().catch(() => {})}>
              ↻ {t("retry")}
            </button>
            <button className="btn btn-icon" onClick={() => setShowGuide(true)}>
              ? {t("localGuideShort")}
            </button>
          </span>
        )}
        {result?.truncated && <span style={{ color: "var(--chg)" }}>· {t("truncated")}</span>}
        {result?.pkgWarning && (
          <span className="whitespace-nowrap" style={{ color: "var(--chg)" }}>· ⚠ {result.pkgWarning}</span>
        )}
        {(result?.nErrors ?? 0) > 0 && (
          <button
            className="chip flex-none cursor-pointer"
            style={{ color: "var(--del)", borderColor: "var(--del)" }}
            onClick={jumpToNextError}
            title={(() => {
              // cascades usually share one root cause — surface the clusters
              const counts = new Map<string, number>();
              for (const s of steps) {
                if (!s.errorMsg) continue;
                const k = s.errorMsg.slice(0, 60);
                counts.set(k, (counts.get(k) ?? 0) + 1);
              }
              return [...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([m, n]) => `${n}× ${m}`)
                .join("\n");
            })()}
          >
            ⚠ {result?.nErrors} {t("errorsChip")}
          </button>
        )}
        {stale && result && <span style={{ color: "var(--chg)" }}>· {t("editHint")}</span>}
        {step?.loop?.map((lf, i) => (
          <span key={i} className="chip mono flex-none" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
            {lf.var ? `${lf.var} = ${lf.value ?? "?"}` : t("iter")} · #{lf.iter}
          </span>
        ))}
        {step?.note && <span style={{ color: "var(--chg)" }}>· {step.note}</span>}
        {step?.errorMsg && (
          <span className="truncate" style={{ color: "var(--del)" }}>
            · {t("errorTitle")}: {step.errorMsg}
          </span>
        )}
      </div>

      {/* ── main split ── */}
      <main className="flex-1 flex min-h-0 p-3">
        {/* left column */}
        <div className="flex flex-col min-w-[280px] gap-3" style={{ width: `${splitX}%` }}>
          <div className="panel flex-1">
            <div className="panel-head">
              {t("code")}
              <span className="ml-auto normal-case tracking-normal font-normal" style={{ color: "var(--ink-faint)" }}>
                ⌘⏎
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <Editor
                initialCode={code}
                onChange={onCodeChange}
                stepLines={step && !stale ? { from: step.line1, to: step.line2 } : null}
                dark={theme === "dark"}
                onRun={() => void run()}
                onSelect={onEditorSelect}
              />
            </div>
            <StepControls steps={steps} index={stepIdx} onChange={setStepIdx} stale={stale} />
          </div>
          <div className="panel flex-none max-h-[170px]">
            <div className="panel-head">{t("files")}</div>
            <FilesPanel files={files} onCodeFile={onCodeFile} />
          </div>
        </div>

        <SplitHandle dir="x" onDrag={(d, box) => setSplitX((w) => clamp(w + (d / box.width) * 100, 24, 70))} />

        {/* right column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="panel" style={{ height: `${splitY}%` }}>
            <div className="panel-head">
              {t("data")}
              {step?.pipe && (
                <span className="normal-case tracking-normal chip mono" style={{ color: "var(--accent)" }}>
                  {step.pipe.index}/{step.pipe.total}
                </span>
              )}
            </div>
            <PipelineRail steps={steps} index={stepIdx} onJump={setStepIdx} />
            <ExplainBar
              step={step}
              prevStep={steps[stepIdx - 1]}
              code={code}
              stale={stale}
              sectionTitle={sectionTitle}
            />
            {step && !stale && (
              <DeltaBar
                env={step.env}
                stepKey={stepIdx}
                onSelect={(name) => setSelected({ name, at: stepIdx })}
              />
            )}
            <DataPanel focus={focus} />
          </div>

          <SplitHandle dir="y" onDrag={(d, box) => setSplitY((h) => clamp(h + (d / box.height) * 100, 25, 80))} />

          <div className="panel flex-1">
            <div className="panel-head" style={{ padding: 0, gap: 0 }}>
              {(["memory", "outline", "variables", "console", "plots"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setBottomTab(tab)}
                  className="px-4 py-1.5 uppercase tracking-[0.08em] text-[11px] font-semibold cursor-pointer"
                  style={{
                    color: bottomTab === tab ? "var(--accent)" : "var(--ink-dim)",
                    boxShadow: bottomTab === tab ? "inset 0 -2px 0 var(--accent)" : "none",
                  }}
                >
                  {t(tab)}
                  {tab === "plots" && plotCount > 0 && <span className="ml-1 mono">({plotCount})</span>}
                  {tab === "variables" && step && <span className="ml-1 mono">({step.env.objs.length})</span>}
                </button>
              ))}
            </div>
            {bottomTab === "memory" && (
              <MemoryGraph
                env={step?.env ?? null}
                stepKey={stepIdx}
                emptyText={t("noVars")}
                onSelectVar={(name) => setSelected({ name, at: stepIdx })}
              />
            )}
            {bottomTab === "outline" && (
              <OutlinePanel code={code} steps={steps} stepIdx={stepIdx} stale={stale} onJump={setStepIdx} />
            )}
            {bottomTab === "variables" && (
              <VariablesPanel
                env={step?.env ?? null}
                selected={focus && focus.storeId == null ? focus.title : null}
                onSelect={(name) => setSelected({ name, at: stepIdx })}
                stepKey={stepIdx}
              />
            )}
            {bottomTab === "console" && (
              <ConsolePanel steps={steps} index={stepIdx} globalError={result?.error} />
            )}
            {bottomTab === "plots" && (
              <PlotsPanel steps={steps} index={stepIdx} plotUrls={result?.plotUrls ?? []} />
            )}
          </div>
        </div>
      </main>
      {inspector && <InspectorPopover state={inspector} onClose={() => setInspector(null)} />}
      {showGuide && <LocalGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function SplitHandle({ dir, onDrag }: { dir: "x" | "y"; onDrag: (delta: number, box: DOMRect) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={dir === "x" ? "vertical" : "horizontal"}
      className="flex-none"
      style={{
        cursor: dir === "x" ? "col-resize" : "row-resize",
        width: dir === "x" ? 12 : undefined,
        height: dir === "y" ? 12 : undefined,
        touchAction: "none",
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const parent = ref.current?.parentElement;
        if (!parent) return;
        const box = parent.getBoundingClientRect();
        let last = dir === "x" ? e.clientX : e.clientY;
        const move = (ev: PointerEvent) => {
          const cur = dir === "x" ? ev.clientX : ev.clientY;
          onDrag(cur - last, box);
          last = cur;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}
