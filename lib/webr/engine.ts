import type { WebR, Shelter } from "webr";
import type {
  DataWindow,
  EngineStatus,
  FnInfo,
  InspectResult,
  ObjPreview,
  RunResult,
  TraceResult,
  TraceStep,
} from "./types";

const BASE_R_PKGS = new Set([
  "base", "stats", "utils", "graphics", "grDevices", "grid", "methods",
  "datasets", "tools", "parallel", "compiler", "splines", "stats4",
  "tcltk", "webr", "magrittr",
]);

const CORE_PKGS = ["jsonlite", "digest"];
const PRELOAD_PKGS = ["dplyr", "tidyr", "ggplot2", "readr", "tibble", "stringr", "purrr", "forcats"];

/** Extract referenced package names from R code. */
export function detectPackages(code: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /(?:library|require|requireNamespace|loadNamespace)\s*\(\s*["']?([A-Za-z][A-Za-z0-9.]*)/g,
    /([A-Za-z][A-Za-z0-9.]*)\s*:::?/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      if (!BASE_R_PKGS.has(m[1])) found.add(m[1]);
    }
  }
  return [...found];
}

export interface UploadedFile {
  name: string;
  size: number;
}

type Listener = (s: EngineStatus) => void;

class REngine {
  private webR: WebR | null = null;
  private shelter: Shelter | null = null;
  private initPromise: Promise<void> | null = null;
  private installed = new Set<string>();
  private listeners = new Set<Listener>();
  private preloading = false;
  status: EngineStatus = { phase: "unloaded" };
  files: UploadedFile[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(phase: EngineStatus["phase"], detail?: string) {
    this.status = { phase, detail };
    this.listeners.forEach((fn) => fn(this.status));
  }

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit() {
    try {
      this.setStatus("downloading", "Downloading R runtime");
      const { WebR } = await import("webr");
      this.webR = new WebR({ baseUrl: "/webr/" });
      await this.webR.init();
      this.setStatus("starting", "Starting R");
      this.shelter = await new this.webR.Shelter();
      await this.webR.evalRVoid('setwd("/home/web_user")');
      this.setStatus("packages", "Installing core packages");
      await this.webR.installPackages(CORE_PKGS, { quiet: true });
      const traceSrc = await (await fetch("/trace.R")).text();
      await this.webR.evalRVoid(traceSrc);
      this.installed = new Set(await this.listInstalled());
      if (process.env.NODE_ENV !== "production") {
        (globalThis as Record<string, unknown>).__engine = this;
      }
      this.setStatus("ready");
      void this.preloadTidyverse();
    } catch (err) {
      this.setStatus("error", err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async listInstalled(): Promise<string[]> {
    if (!this.webR) return [];
    const joined = await this.webR.evalRString(
      'paste(rownames(installed.packages()), collapse = "\\n")',
    );
    return joined.split("\n").filter(Boolean);
  }

  private async preloadTidyverse() {
    if (this.preloading || !this.webR) return;
    this.preloading = true;
    try {
      const missing = PRELOAD_PKGS.filter((p) => !this.installed.has(p));
      if (missing.length) {
        this.setStatus("ready", `Preloading tidyverse (${missing.length} pkgs) in background`);
        await this.webR.installPackages(missing, { quiet: true });
        missing.forEach((p) => this.installed.add(p));
      }
      if (this.status.phase === "ready") this.setStatus("ready");
    } catch {
      // preload is best-effort; on-demand install covers the gap
      if (this.status.phase === "ready") this.setStatus("ready");
    } finally {
      this.preloading = false;
    }
  }

  async ensurePackages(pkgs: string[], onDetail: (d: string) => void): Promise<string[]> {
    if (!this.webR) throw new Error("engine not initialized");
    const missing = pkgs.filter((p) => !this.installed.has(p));
    if (!missing.length) return [];
    onDetail(`Installing: ${missing.join(", ")}`);
    await this.webR.installPackages(missing, { quiet: true });
    const now = new Set(await this.listInstalled());
    const failed = missing.filter((p) => !now.has(p));
    this.installed = now;
    return failed;
  }

  async runTrace(
    code: string,
    stepLoops: boolean,
    opts: { continueOnError?: boolean; maxSteps?: number; keepWorkspace?: boolean } = {},
  ): Promise<RunResult> {
    const { continueOnError = true, maxSteps = 1000, keepWorkspace = false } = opts;
    await this.init();
    if (!this.webR) throw new Error("engine not initialized");
    this.setStatus("running", "Checking packages");
    try {
      // Packages that fail to install are only a warning: the corresponding
      // library() call errors at its own step and (by default) execution
      // continues — matching how a real script behaves in a fresh session.
      const failed = await this.ensurePackages(detectPackages(code), (d) =>
        this.setStatus("running", d),
      );
      const pkgWarning = failed.length
        ? `Not installable in webR: ${failed.join(", ")}`
        : undefined;
      this.setStatus("running", "Tracing execution");
      await this.webR.FS.writeFile(
        "/tmp/.user_code.R",
        new TextEncoder().encode(code),
      );
      if (!this.shelter) throw new Error("engine not initialized");
      let images: ImageBitmap[] = [];
      try {
        // webR's canvas device renders at 2x internally, so a 840x580 request
        // yields a 1680x1160 bitmap — already crisp on HiDPI displays.
        const capture = await this.shelter.captureR(
          `invisible(.tr_run_file('/tmp/.user_code.R', ${stepLoops ? "TRUE" : "FALSE"}, ` +
            `${continueOnError ? "FALSE" : "TRUE"}, ${Math.max(100, Math.min(10000, maxSteps))}L, ` +
            `${keepWorkspace ? "FALSE" : "TRUE"}))`,
          {
            captureGraphics: { width: 840, height: 580, pointsize: 12, bg: "white" },
          },
        );
        images = capture.images;
      } finally {
        await this.shelter.purge();
      }
      const json = await this.webR.evalRString(".tr_last_json()");
      const trace = JSON.parse(json) as TraceResult;
      normalizeTrace(trace);
      const plotUrls = images.map((img) => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d")!.drawImage(img, 0, 0);
        return canvas.toDataURL("image/png");
      });
      return { ...trace, plotUrls, pkgWarning };
    } finally {
      this.setStatus("ready");
    }
  }

  async page(
    step: number, name: string,
    row0: number, nrows: number, col0: number, ncols: number,
  ): Promise<DataWindow> {
    if (!this.webR) throw new Error("engine not initialized");
    const json = await this.webR.evalRString(
      `.tr_page(${step}, ${JSON.stringify(name)}, ${row0}, ${nrows}, ${col0}, ${ncols})`,
    );
    return normalizeWindow(JSON.parse(json) as DataWindow);
  }

  async pipePage(
    storeId: number,
    row0: number, nrows: number, col0: number, ncols: number,
  ): Promise<DataWindow> {
    if (!this.webR) throw new Error("engine not initialized");
    const json = await this.webR.evalRString(
      `.tr_pipe_page(${storeId}, ${row0}, ${nrows}, ${col0}, ${ncols})`,
    );
    return normalizeWindow(JSON.parse(json) as DataWindow);
  }

  async inspect(step: number, src: string, pipeStoreId?: number | null): Promise<InspectResult> {
    if (!this.webR) throw new Error("engine not initialized");
    const sid = pipeStoreId == null ? "NULL" : String(pipeStoreId);
    const json = await this.webR.evalRString(
      `.tr_inspect_json(${step}, ${JSON.stringify(src)}, ${sid})`,
    );
    const res = JSON.parse(json) as InspectResult;
    if (res.value) normalizePreview(res.value);
    if (res.args) res.args = arr(res.args);
    return res;
  }

  async fnInfo(name: string): Promise<FnInfo | null> {
    if (!this.webR) throw new Error("engine not initialized");
    const json = await this.webR.evalRString(`.tr_fn_info_json(${JSON.stringify(name)})`);
    const res = JSON.parse(json) as FnInfo | null;
    return res && res.name ? res : null;
  }

  async uploadFile(name: string, data: Uint8Array): Promise<void> {
    await this.init();
    if (!this.webR) throw new Error("engine not initialized");
    // preserve relative sub-paths ("CAUSALITY/resume.csv") so real project
    // scripts with directory-relative reads work as-is
    const safe = name
      .replace(/\\/g, "/")
      .split("/")
      .filter((p) => p && p !== "." && p !== "..")
      .join("/");
    const parts = safe.split("/");
    let dir = "/home/web_user";
    for (const seg of parts.slice(0, -1)) {
      dir = `${dir}/${seg}`;
      try {
        await this.webR.FS.mkdir(dir);
      } catch {
        // already exists
      }
    }
    await this.webR.FS.writeFile(`/home/web_user/${safe}`, data);
    this.files = [
      ...this.files.filter((f) => f.name !== safe),
      { name: safe, size: data.byteLength },
    ];
    this.listeners.forEach((fn) => fn(this.status));
  }

  async removeFile(name: string): Promise<void> {
    if (!this.webR) return;
    try {
      await this.webR.FS.unlink(`/home/web_user/${name}`);
    } catch {
      // already gone
    }
    this.files = this.files.filter((f) => f.name !== name);
    this.listeners.forEach((fn) => fn(this.status));
  }

  interrupt() {
    this.webR?.interrupt();
  }
}

function arr<T>(x: T[] | T | null | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function normalizeTree(node: NonNullable<ObjPreview["tree"]>): void {
  if (node.cls != null) node.cls = arr(node.cls);
  if (node.preview != null) node.preview = arr(node.preview);
  if (node.children != null) {
    node.children = arr(node.children);
    for (const c of node.children) normalizeTree(c);
  }
}

/** Undo jsonlite auto_unbox on array-valued preview fields. */
function normalizePreview(o: ObjPreview): ObjPreview {
  if (o.cls != null) o.cls = arr(o.cls);
  if (o.values != null) o.values = arr(o.values);
  if (o.names != null) o.names = arr(o.names);
  if (o.levels != null) o.levels = arr(o.levels);
  if (o.print != null) o.print = arr(o.print);
  if (o.items != null) o.items = arr(o.items);
  if (o.cols != null) o.cols = arr(o.cols);
  if (o.rowNames != null) o.rowNames = arr(o.rowNames);
  if (o.cells != null) o.cells = arr(o.cells).map((c) => arr(c));
  if (o.tree != null) normalizeTree(o.tree);
  if (o.delta != null) normalizeDelta(o.delta);
  return o;
}

function normalizeDelta(d: NonNullable<ObjPreview["delta"]>): void {
  if (d.colsAdded != null) d.colsAdded = arr(d.colsAdded);
  if (d.colsRemoved != null) d.colsRemoved = arr(d.colsRemoved);
  if (d.colsChanged != null) d.colsChanged = arr(d.colsChanged);
  if (d.removedSample != null) d.removedSample = arr(d.removedSample);
  if (d.groups != null) d.groups = arr(d.groups);
  if (d.colsRetyped != null) d.colsRetyped = arr(d.colsRetyped);
  if (d.naIntro != null) d.naIntro = arr(d.naIntro);
}

/** Same treatment for on-demand data windows. */
export function normalizeWindow(w: DataWindow): DataWindow {
  if (w.cols != null) w.cols = arr(w.cols);
  if (w.values != null) w.values = arr(w.values);
  if (w.cells != null) w.cells = arr(w.cells).map((c) => arr(c));
  return w;
}

/**
 * Reconstruct each step's full environment from the delta snapshots the R side
 * emits (only added/changed previews plus removed names), and normalize
 * jsonlite's auto_unboxed scalars back into arrays.
 */
export function normalizeTrace(trace: TraceResult) {
  const last = new Map<string, ObjPreview>();
  for (const o of arr(trace.baseline)) {
    normalizePreview(o);
    last.set(o.name, o);
  }
  for (const step of trace.steps as TraceStep[]) {
    step.stdout = arr(step.stdout);
    step.conds = arr(step.conds);
    step.env.added = arr(step.env.added);
    step.env.changed = arr(step.env.changed);
    step.env.removed = arr(step.env.removed);
    step.plots = arr(step.plots);
    if (step.loop != null) step.loop = arr(step.loop);
    if (step.pipe?.value) normalizePreview(step.pipe.value);
    if (step.pipe?.delta) normalizeDelta(step.pipe.delta);
    for (const o of arr(step.env.objs)) {
      normalizePreview(o);
      last.set(o.name, o);
    }
    for (const name of step.env.removed) last.delete(name);
    step.env.objs = [...last.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

let engine: REngine | null = null;

export function getEngine(): REngine {
  if (!engine) engine = new REngine();
  return engine;
}

export type { REngine };
