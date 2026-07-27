import { getEngine, type UploadedFile } from "./webr/engine";
import { getLocalEngine } from "./localEngine";
import type { DataWindow, EngineStatus, FnInfo, InspectResult, RunResult } from "./webr/types";

export type Backend = "webr" | "local";

/** The engine surface both backends implement. */
export interface EngineAPI {
  status: EngineStatus;
  files: UploadedFile[];
  subscribe(fn: (s: EngineStatus) => void): () => void;
  init(): Promise<void>;
  runTrace(
    code: string,
    stepLoops: boolean,
    opts?: { continueOnError?: boolean; maxSteps?: number; keepWorkspace?: boolean },
  ): Promise<RunResult>;
  page(step: number, name: string, row0: number, nrows: number, col0: number, ncols: number): Promise<DataWindow>;
  pipePage(storeId: number, row0: number, nrows: number, col0: number, ncols: number): Promise<DataWindow>;
  inspect(step: number, src: string, pipeStoreId?: number | null): Promise<InspectResult>;
  fnInfo(name: string): Promise<FnInfo | null>;
  uploadFile(name: string, data: Uint8Array): Promise<void>;
  removeFile(name: string): Promise<void>;
  interrupt(): void;
}

let backend: Backend = "webr";

export function setBackend(b: Backend) {
  backend = b;
}

export function getBackend(): Backend {
  return backend;
}

export function getActiveEngine(): EngineAPI {
  return backend === "local" ? getLocalEngine() : (getEngine() as unknown as EngineAPI);
}
