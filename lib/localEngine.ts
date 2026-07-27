import { normalizeTrace, normalizeWindow, type UploadedFile } from "./webr/engine";
import type {
  DataWindow,
  EngineStatus,
  FnInfo,
  InspectResult,
  RunResult,
  TraceResult,
} from "./webr/types";

const BASE = "http://127.0.0.1:8790";

type Listener = (s: EngineStatus) => void;

/**
 * Drop-in engine backed by a desktop R process running
 * `Rscript local-backend/serve.R` — same trace protocol as webR, but with
 * the user's full local package library (CRAN, GitHub, Bioconductor…).
 */
export class LocalEngine {
  status: EngineStatus = { phase: "unloaded" };
  files: UploadedFile[] = [];
  private listeners = new Set<Listener>();
  private initPromise: Promise<void> | null = null;
  private healthDetail: string | undefined;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(phase: EngineStatus["phase"], detail?: string, authRequired = false) {
    this.status = { phase, detail, authRequired };
    this.listeners.forEach((fn) => fn(this.status));
  }

  private token(): string {
    try {
      return localStorage.getItem("rviz-local-token") ?? "";
    } catch {
      return "";
    }
  }

  /** Store the token printed by serve.R and retry the connection. */
  setToken(t: string) {
    try {
      localStorage.setItem("rviz-local-token", t.trim());
    } catch {
      // storage unavailable — token kept only for this attempt
    }
    this.initPromise = null;
    void this.init().catch(() => {});
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const t = this.token();
    if (t) h["X-RViz-Token"] = t;
    return h;
  }

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit() {
    this.setStatus("starting", "Connecting to local R");
    try {
      const r = await fetch(`${BASE}/health`, { headers: this.headers() });
      const h = (await r.json()) as {
        ok: boolean;
        authRequired?: boolean;
        r?: string;
        wd?: string;
        ver?: string;
      };
      if (h.authRequired) {
        this.initPromise = null;
        this.setStatus("error", "token", true);
        throw new Error("token required");
      }
      // protocol handshake: an older running backend silently lacks newer
      // features (deltas, inspect) — tell the user to restart it
      const outdated = h.ver !== "2";
      this.healthDetail = `Local R ${h.r} · ${h.wd}${outdated ? " · ⚠ backend outdated — restart it with the latest rviz-local.R" : ""}`;
      this.setStatus("ready", this.healthDetail);
    } catch (e) {
      this.initPromise = null;
      if (this.status.authRequired) throw e;
      this.setStatus("error", "unreachable");
      throw new Error("local backend unreachable");
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error ?? `local backend ${r.status}`);
    }
    return (await r.json()) as T;
  }

  async runTrace(
    code: string,
    stepLoops: boolean,
    opts: { continueOnError?: boolean; maxSteps?: number; keepWorkspace?: boolean } = {},
  ): Promise<RunResult> {
    await this.init();
    this.setStatus("running", "Tracing on local R");
    try {
      const data = await this.post<{ trace: TraceResult; plots: string[] }>("/run", {
        code,
        stepLoops,
        continueOnError: opts.continueOnError ?? true,
        maxSteps: opts.maxSteps ?? 1000,
        keepWorkspace: opts.keepWorkspace ?? false,
      });
      const trace = data.trace;
      normalizeTrace(trace);
      return { ...trace, plotUrls: data.plots ?? [] };
    } finally {
      this.setStatus("ready", this.healthDetail);
    }
  }

  async page(step: number, name: string, row0: number, nrows: number, col0: number, ncols: number): Promise<DataWindow> {
    return normalizeWindow(await this.post<DataWindow>("/page", { step, name, row0, nrows, col0, ncols }));
  }

  async pipePage(storeId: number, row0: number, nrows: number, col0: number, ncols: number): Promise<DataWindow> {
    return normalizeWindow(await this.post<DataWindow>("/pipe_page", { storeId, row0, nrows, col0, ncols }));
  }

  async inspect(step: number, src: string, pipeStoreId?: number | null): Promise<InspectResult> {
    return await this.post<InspectResult>("/inspect", { step, src, pipeStoreId: pipeStoreId ?? null });
  }

  async fnInfo(name: string): Promise<FnInfo | null> {
    const res = await this.post<FnInfo | null>("/fn_info", { name });
    return res && res.name ? res : null;
  }

  async uploadFile(name: string, data: Uint8Array): Promise<void> {
    await this.init();
    let bin = "";
    for (let i = 0; i < data.length; i += 0x8000) {
      bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    }
    const res = await this.post<{ name: string }>("/upload", { name, data: btoa(bin) });
    this.files = [
      ...this.files.filter((f) => f.name !== res.name),
      { name: res.name, size: data.byteLength },
    ];
    this.listeners.forEach((fn) => fn(this.status));
  }

  async removeFile(name: string): Promise<void> {
    await this.post("/remove", { name }).catch(() => {});
    this.files = this.files.filter((f) => f.name !== name);
    this.listeners.forEach((fn) => fn(this.status));
  }

  interrupt() {
    // not supported over the HTTP bridge
  }
}

let local: LocalEngine | null = null;
export function getLocalEngine(): LocalEngine {
  if (!local) local = new LocalEngine();
  return local;
}
