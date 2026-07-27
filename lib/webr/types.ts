export type ObjKind =
  | "data.frame"
  | "matrix"
  | "vector"
  | "factor"
  | "list"
  | "function"
  | "object"
  | "other"
  | "null";

/** Recursive structural view of any R object (S3/S4/R6/S7/env/list/...). */
export interface ObjTreeNode {
  cls?: string[] | string;
  type?: string; // s7 | s4 | r6 | env | ggproto | df | matrix | factor | atomic | function | list | null | other
  summary?: string;
  summaryFull?: string;
  dims?: string;
  n?: number;
  vtype?: string;
  sig?: string;
  size?: number;
  preview?: string[] | string;
  /** stable identity for reference-semantics objects (env/R6) — shared refId means the SAME object */
  refId?: string;
  cycle?: boolean;
  truncated?: boolean;
  children?: (ObjTreeNode & { name: string })[];
}

export interface FnInfo {
  name: string;
  pkg?: string | null;
  sig?: string | null;
  title?: string | null;
}

export interface InspectResult {
  ok: boolean;
  source: string;
  error?: string;
  note?: string; // "side-effect"
  isSymbol?: boolean;
  resampled?: boolean;
  value?: ObjPreview;
  fn?: FnInfo | null;
  args?: { name: string; code: string; summary: string }[];
}

export interface ParseSpan {
  id: number;
  parent: number;
  line1: number;
  col1: number;
  line2: number;
  col2: number;
}

export interface ColInfo {
  name: string;
  type: string;
}

export interface ObjPreview {
  name: string;
  cls?: string[] | string;
  kind?: ObjKind;
  fp?: string;
  size?: number;
  ref?: boolean;
  // data.frame / matrix
  nrow?: number;
  ncol?: number;
  cols?: ColInfo[];
  cells?: string[][]; // column-major
  rowNames?: string[] | null;
  // vector / factor
  vtype?: string;
  length?: number;
  values?: string[];
  names?: string[];
  nlevels?: number;
  levels?: string[];
  // list
  items?: { name: string; cls: string; length: number }[];
  // function
  args?: string;
  // object (generic OOP tree)
  summary?: string;
  tree?: ObjTreeNode;
  /** dataset-semantics diff vs the previous step (any modified data frame) */
  delta?: DataDelta | null;
  // other (legacy)
  print?: string[] | string;
}

export interface Cond {
  type: "message" | "warning";
  text: string;
}

/** Dataset-semantics diff between consecutive pipe values. */
export interface DataDelta {
  colsAdded?: string[];
  colsRemoved?: string[];
  colsChanged?: string[];
  rowDelta?: number;
  rowsRemovedExact?: number;
  removedSample?: string[];
  reordered?: boolean;
  /** active grouping variables (grouped_df) — invisible in the data itself */
  groups?: string[];
  colsRetyped?: { col: string; from: string; to: string }[];
  naIntro?: { col: string; n: number }[];
}

export interface PipeInfo {
  index: number;
  total: number;
  label: string;
  op?: string; // "|>" | "%>%" | "+"
  delta?: DataDelta | null;
  value?: ObjPreview;
  storeId?: number | null;
}

export interface LoopFrame {
  var: string | null;
  iter: number;
  value: string | null;
}

export interface EnvSnapshot {
  objs: ObjPreview[];
  added: string[];
  changed: string[];
  removed: string[];
  stored: boolean;
}

export interface TraceStep {
  i: number;
  line1: number;
  line2: number;
  kind: "stmt" | "pipe" | "error" | "loop-fold";
  stdout: string[];
  conds: Cond[];
  plots: number[];
  loop: LoopFrame[] | null;
  env: EnvSnapshot;
  pipe?: PipeInfo;
  errorMsg?: string;
  note?: string;
}

export interface TraceResult {
  ok: boolean;
  error: string | null;
  nErrors?: number;
  /** previews of variables inherited from a kept workspace (delta base) */
  baseline?: ObjPreview[] | null;
  parseSpans?: ParseSpan[] | null;
  truncated: boolean;
  nPlots: number;
  envStored: boolean;
  steps: TraceStep[];
}

/** Trace result with plots rendered to data URLs and env refs resolved. */
export interface RunResult extends TraceResult {
  plotUrls: string[]; // index = plot id - 1
  /** packages referenced by the code that could not be installed in webR */
  pkgWarning?: string;
}

export interface DataWindow {
  kind: "window" | "vwindow" | "empty" | "missing" | "unsupported";
  source?: "step" | "final" | "pipe";
  row0?: number;
  col0?: number;
  nrow?: number;
  ncol?: number;
  length?: number;
  cols?: ColInfo[];
  cells?: string[][];
  values?: string[];
}

export type EnginePhase =
  | "unloaded"
  | "downloading"
  | "starting"
  | "packages"
  | "ready"
  | "running"
  | "error";

export interface EngineStatus {
  phase: EnginePhase;
  detail?: string;
  /** local backend: reachable but waiting for the session token */
  authRequired?: boolean;
}
