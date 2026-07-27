// Bundle the local backend into a single self-contained R script that users
// of the deployed site can run with one command:
//   Rscript -e 'source("https://<your-app>/rviz-local.R")'
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const trace = readFileSync(join(root, "public", "trace.R"), "utf8");
const serve = readFileSync(join(root, "local-backend", "serve.R"), "utf8");

const begin = "## == repo-source-begin ==";
const end = "## == repo-source-end ==";
const i0 = serve.indexOf(begin);
const i1 = serve.indexOf(end);
if (i0 === -1 || i1 === -1) throw new Error("serve.R markers not found");

const bundled =
  "# R Visualizer — self-contained local backend (generated; do not edit)\n" +
  "# Usage: Rscript rviz-local.R   — or —   Rscript -e 'source(\"<app-origin>/rviz-local.R\")'\n" +
  "# Run it from the directory that holds your data files.\n\n" +
  "## ---- trace engine (inlined from public/trace.R) ----\n" +
  trace +
  "\n## ---- server ----\n" +
  serve.slice(0, i0) +
  serve.slice(i1 + end.length);

writeFileSync(join(root, "public", "rviz-local.R"), bundled);
console.log(`rviz-local.R bundled (${(bundled.length / 1024).toFixed(0)} KB)`);
