// Sync self-hosted webR wasm assets into public/webr (required for cross-origin isolation)
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "webr", "dist");
const dest = join(root, "public", "webr");

mkdirSync(dest, { recursive: true });
for (const item of ["webr-worker.js", "R.js", "R.wasm", "libRblas.so", "libRlapack.so", "vfs"]) {
  cpSync(join(src, item), join(dest, item), { recursive: true });
}
console.log(`webR assets copied to ${dest}`);
