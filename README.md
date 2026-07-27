# R Visualizer — `code |> viz()`

A Python-Tutor-style step-through visualizer for **R and the tidyverse**, running entirely in the browser via [webR](https://docs.r-wasm.org/webr/latest/) (R compiled to WebAssembly). No server-side R — deployable as a static Next.js app on Vercel.

## What it does

- **Step through R code** statement by statement with a slider, arrow keys, and a highlighted current line.
- **Pipe breakdown**: `df |> filter() |> mutate()` chains (both `|>` and `%>%`) are split into per-link steps — each intermediate data frame is shown in a hexagon pipeline rail with rows × cols.
- **Loop stepping (toggleable)**: `for` / `while` / `repeat` bodies are AST-instrumented so every statement of every iteration is a step, with iteration badges (`i = 3 · #4`). Iterations beyond 100 fold into one step; global cap 1000 steps. Turn the toggle off to treat a loop as a single step.
- **Environment snapshots** per step with added / changed / removed highlighting, plus a data-frame viewer with column-type badges and cell-level diffs.
- **Big data safe**: previews are windowed (50 rows × 60 cols), the grid is virtualized in both directions, and more rows/columns load on demand from the live R session. Unchanged objects are structurally shared across steps.
- **Plots**: base R and ggplot2 graphics captured per step on webR's canvas device (2× resolution), with zoom + PNG download.
- **Package support**: dplyr/tidyr/ggplot2/readr/tibble/stringr/purrr/forcats preload in the background; any other CRAN package referenced by `library()` / `::` is installed on demand from [repo.r-wasm.org](https://repo.r-wasm.org) (20k+ packages built for wasm).
- **Upload your own work**: `.R` files open in the editor; data files (`.csv`, `.tsv`, `.rds`, `.xlsx`, …) land in the R working directory for `read_csv("file.csv")` etc.
- **Bilingual UI** (English / 中文) and light / dark themes.
- **Python-Tutor-style memory diagrams, in a graphical language designed for R** (Memory tab): workspace name slots on the left; objects as class-labelled boxes with object-system badges (S7 · S4 · R6 · env · ggproto). The notation encodes R's actual semantics — **value semantics (copy-on-write) = nesting**, **reference semantics = arrows into a shared heap column**, so `b <- a` on an R6 object draws two arrows into ONE box and a later `a$deposit(100)` visibly changes it for both names. Vectors are typed cell strips with indices, data frames are grid badges, functions are signature boxes; green/amber borders mark added/changed.
- **Intrinsic code explanation, not templates**: any operator spine is split into steps (`|>`, `%>%`, and ggplot's `+` — each layer/scale/labs link shows the accumulating S7 plot object through a class "lens"); selecting any sub-expression (e.g. `factor(cyl)` inside `mutate`, or `aes(...)`) maps the selection to the smallest enclosing AST node via R's parse data and re-evaluates it (guard-railed: timeouts, side-effect blocklist, null graphics device, data-mask layering for piped verbs) in that step's retained environment — the popover shows the live value, the function's signature, its package, its one-line description from the package's own INDEX metadata, and each argument evaluated.
- **Generic OOP inspector** for every R object system — S3 attributes, S4 slots, S7 properties (`S7::props`), R6 fields/methods, environments with cycle detection, ggproto — rendered as collapsible trees and used across the data panel, pipeline rail and inspector.
- **Plain-language step explanations** for non-experts: every step gets a bilingual one-liner built from runtime facts — "filter(): keeps only matching rows · 87 → 59 rows (−28)", "summarise(): collapses each group into one row · 59 → 32, new columns: n, mean_bmi" — plus row/col delta badges (−28r / +1c) on the pipeline nodes and green highlighting of newly created columns.
- **Real-workflow options**: continue-after-errors (recorded as red steps with an error-jump chip), keep-workspace across runs (fragment-by-fragment analysis like lmb_1 → lmb_5 in the Mixtape), configurable step cap (1000/2000/5000), and non-installable packages downgrade to a warning instead of blocking the run.

Battle-tested against real quantitative social-science code: all 14 chapter scripts of Imai's *Quantitative Social Science* (base + tidyverse versions) and all 58 replication scripts of Cunningham's *Causal Inference: The Mixtape* replay with zero engine crashes (see `docs/SCALING.md` §4).

## Architecture

| Piece | Where | Role |
| --- | --- | --- |
| Trace engine (R) | `public/trace.R` | Parses user code with srcrefs, splits pipes, instruments loops, evaluates per statement while capturing stdout/conditions/errors, snapshots the environment to JSON (jsonlite), tracks plot pages via `before.plot.new` hooks, serves on-demand data windows. |
| Engine wrapper (TS) | `lib/webr/engine.ts` | Boots webR from self-hosted assets (`/webr/`), installs packages, runs traces inside `Shelter.captureR` with canvas graphics capture, converts plots to data URLs, normalizes jsonlite output. |
| UI | `app/page.tsx`, `components/` | CodeMirror 6 editor, step controls, pipeline rail, virtualized data grid, variables/console/plots panels, file upload, i18n, themes. |

webR needs cross-origin isolation for its SharedArrayBuffer channel; `next.config.ts` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` and the wasm assets are copied from `node_modules/webr/dist` into `public/webr/` by `scripts/copy-webr.mjs` (runs automatically before `dev` and `build`).

## Develop

```bash
npm install
npm run dev
```

First load downloads the R runtime (~20 MB) and background-installs the tidyverse core; subsequent loads use the browser cache.

## Run locally (full desktop R, any package) — works from the deployed site too

webR covers most of CRAN, but some packages (GitHub-only ones like `qss`, or packages without a wasm build such as `Synth` / `MatchIt`) only exist in a desktop R installation. The **Local R** engine runs the *same* trace protocol on your own R — everything else (UI, stepping, pipeline rail, explanations, outline) is identical; only the execution backend and package source change.

**For users of the deployed (Vercel) app** — no repo checkout needed:

1. In your desktop R (or RStudio), install the bridge deps plus whatever your scripts need:
   ```r
   install.packages(c("httpuv", "jsonlite", "digest"))
   devtools::install_github("kosukeimai/qss-package")   # any GitHub package
   ```
2. From the directory that holds your data files, run the one-liner shown in the app (the build publishes a self-contained script at `/rviz-local.R`):
   ```bash
   Rscript -e 'source("https://<your-app>.vercel.app/rviz-local.R")'
   ```
3. The backend prints a **session token**. In the app's top bar switch the engine to **Local R** and paste the token when prompted. The status bar then shows your R version and working directory; uploads land in that directory and `read_csv("...")` resolves against it.

If the backend isn't running, the app shows the exact command (with your deployment's URL) and a copy button.

Details that make this work from an HTTPS deployment:
- Browsers exempt `http://127.0.0.1` from mixed-content blocking, and the bridge answers Chrome's Private-Network-Access preflight (`Access-Control-Allow-Private-Network: true`). Chromium and Firefox work; Safari currently blocks HTTPS→loopback requests.
- The bridge binds to `127.0.0.1` only and requires the per-session token (it executes R code, so unauthenticated cross-site calls must be refused). `--no-token` disables the check on trusted machines. Code and data never leave your machine — the page only talks to loopback.

**From a repo checkout**: `Rscript local-backend/serve.R` does the same thing (the published `rviz-local.R` is this file with `public/trace.R` inlined, generated by `scripts/build-local.mjs` at build time).

## Deploy to Vercel

The app is fully static (`next build` prerenders everything; R runs client-side), so a plain deploy works:

```bash
npm i -g vercel
vercel deploy        # preview
vercel deploy --prod # production
```

The `prebuild` script copies the webR wasm assets during Vercel's build, and `headers()` in `next.config.ts` provides the COOP/COEP headers.

## Scale

Snapshots are **deltas**: each step ships only the objects that appeared or changed (unchanged bindings are skipped via `identical()`'s pointer fast-path), and the frontend reconstructs the full environment cumulatively. Measured: a 600-statement script traces in ~1.3 s natively / ~3.6 s in wasm with a 169 KB payload; a million-row data frame pages any 50-row window in <10 ms. Guardrails: 1000-step cap, 100-iteration loop folding, 50×60 preview windows, sampled fingerprints for objects >8 MB, and a 200 MB budget for retained per-step environments. See `docs/SCALING.md` for the production-scale design notes and `tests/stress-trace.R` for the benchmark battery (`Rscript tests/stress-trace.R` from the repo root).

## Known limitations

- Stepping granularity is per statement; the bodies of user-defined *functions* are not stepped into (loops are).
- Additions to an existing plot page (`points()`, `lines()`) and `par(mfrow=...)` sub-figures aren't tracked as separate plot steps.
- Native-pipe detection counts `|>` in source text, so a `|>` inside a string on the same line can mislabel (not mis-execute) a step.
- Packages without a wasm build on repo.r-wasm.org can't be installed (a clear error is shown).
