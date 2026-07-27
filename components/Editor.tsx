"use client";

import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers, drawSelection, highlightSpecialChars } from "@codemirror/view";
import { EditorState, StateEffect, StateField, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from "@codemirror/language";
import { r } from "@codemirror/legacy-modes/mode/r";
import { tags as t } from "@lezer/highlight";
import { Decoration, type DecorationSet } from "@codemirror/view";

const setStepLines = StateEffect.define<{ from: number; to: number } | null>();

const stepLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setStepLines)) {
        if (!e.value) return Decoration.none;
        const { from, to } = e.value;
        const doc = tr.state.doc;
        const marks = [];
        for (let ln = Math.max(1, from); ln <= Math.min(to, doc.lines); ln++) {
          const line = doc.line(ln);
          marks.push(Decoration.line({ class: "cm-current-step" }).range(line.from));
        }
        return Decoration.set(marks);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function makeHighlight(dark: boolean) {
  return HighlightStyle.define([
    { tag: t.keyword, color: dark ? "#c792ea" : "#7c4dbe" },
    { tag: t.comment, color: dark ? "#5d6b8a" : "#9aa0b0", fontStyle: "italic" },
    { tag: t.string, color: dark ? "#8fc98f" : "#2e7d32" },
    { tag: t.number, color: dark ? "#e0b35e" : "#b26a00" },
    { tag: [t.operator, t.punctuation], color: dark ? "#89a0c8" : "#5b6575" },
    { tag: [t.variableName, t.name], color: dark ? "#e6eaf2" : "#1c2433" },
    { tag: [t.function(t.variableName), t.labelName], color: dark ? "#6e9be0" : "#3564b0" },
    { tag: t.bool, color: dark ? "#e0b35e" : "#b26a00" },
  ]);
}

export interface EditorSelection {
  line1: number;
  col1: number;
  line2: number;
  col2: number; // inclusive
  text: string;
  coords: { x: number; y: number };
}

export interface EditorProps {
  initialCode: string;
  onChange: (code: string) => void;
  stepLines: { from: number; to: number } | null;
  dark: boolean;
  onRun?: () => void;
  onSelect?: (sel: EditorSelection | null) => void;
}

export default function Editor({ initialCode, onChange, stepLines, dark, onRun, onSelect }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onSelectRef = useRef(onSelect);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onSelectRef.current = onSelect;

  // create the editor once
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialCode,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightSpecialChars(),
          bracketMatching(),
          StreamLanguage.define(r),
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                onRunRef.current?.();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          stepLineField,
          themeComp.current.of(syntaxHighlighting(makeHighlight(dark))),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const sel = u.state.selection.main;
              if (sel.empty || u.docChanged) {
                onSelectRef.current?.(null);
              } else {
                try {
                  const doc = u.state.doc;
                  const lf = doc.lineAt(sel.from);
                  const lt = doc.lineAt(Math.max(sel.from, sel.to - 1));
                  const coords = u.view.coordsAtPos(sel.to);
                  onSelectRef.current?.({
                    line1: lf.number,
                    col1: sel.from - lf.from + 1,
                    line2: lt.number,
                    col2: Math.max(sel.from, sel.to - 1) - lt.from + 1,
                    text: doc.sliceString(sel.from, sel.to),
                    coords: coords ? { x: coords.left, y: coords.bottom } : { x: 200, y: 200 },
                  });
                } catch {
                  onSelectRef.current?.(null);
                }
              }
            }
          }),
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { fontFamily: "var(--font-plex-mono), monospace", lineHeight: "1.55" },
            ".cm-content": { caretColor: "var(--accent)", padding: "8px 0" },
            ".cm-cursor": { borderLeftColor: "var(--accent)" },
            ".cm-selectionBackground": { background: "var(--blue-soft) !important" },
            ".cm-activeLine": { background: "transparent" },
            ".cm-lineNumbers .cm-gutterElement": { minWidth: "34px", padding: "0 8px 0 4px" },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme swap
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeComp.current.reconfigure(syntaxHighlighting(makeHighlight(dark))),
    });
  }, [dark]);

  // step-line highlight + scroll into view
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setStepLines.of(stepLines) });
    if (stepLines && stepLines.from >= 1 && stepLines.from <= view.state.doc.lines) {
      const pos = view.state.doc.line(stepLines.from).from;
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "nearest", yMargin: 40 }) });
    }
  }, [stepLines]);

  // external code replacement (examples / file upload)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== initialCode) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: initialCode },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  return <div ref={hostRef} className="h-full min-h-0" />;
}
