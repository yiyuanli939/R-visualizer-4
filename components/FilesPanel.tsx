"use client";

import { useCallback, useRef, useState } from "react";
import type { UploadedFile } from "@/lib/webr/engine";
import { getActiveEngine } from "@/lib/activeEngine";
import { useT } from "@/lib/i18n";

export default function FilesPanel({
  files, onCodeFile,
}: { files: UploadedFile[]; onCodeFile: (name: string, code: string) => void }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = useCallback(
    async (list: FileList | File[]) => {
      for (const file of Array.from(list)) {
        if (/\.(r|R)$/.test(file.name)) {
          onCodeFile(file.name, await file.text());
        } else {
          const buf = new Uint8Array(await file.arrayBuffer());
          await getActiveEngine().uploadFile(file.name, buf);
        }
      }
    },
    [onCodeFile],
  );

  return (
    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
      <button
        className="rounded-lg px-3 py-2 text-[11px] leading-snug text-center cursor-pointer"
        style={{
          border: `1.5px dashed ${drag ? "var(--accent)" : "var(--line)"}`,
          color: "var(--ink-dim)",
          background: drag ? "var(--accent-soft)" : "transparent",
        }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        {t("dropHint")}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {files.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "var(--ink-faint)" }}>
            {t("uploaded")}
          </div>
          {files.map((f) => (
            <div key={f.name} className="flex items-center gap-2 px-1 py-0.5 text-xs mono">
              <span className="truncate">{f.name}</span>
              <span style={{ color: "var(--ink-faint)" }}>{(f.size / 1024).toFixed(1)} KB</span>
              <button
                className="ml-auto cursor-pointer"
                style={{ color: "var(--del)" }}
                title={t("removeFile")}
                onClick={() => void getActiveEngine().removeFile(f.name)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
