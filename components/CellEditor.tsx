"use client";

import { useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { Prec, RangeSetBuilder, type EditorState } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

// JupyterLab light theme syntax colours (--jp-mirror-editor-*).
const jupyterHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "#008000", fontWeight: "bold" },
  { tag: [t.bool, t.null, t.self], color: "#008000", fontWeight: "bold" },
  { tag: [t.operatorKeyword, t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator], color: "#aa22ff", fontWeight: "bold" },
  { tag: [t.number, t.integer, t.float], color: "#008800" },
  { tag: [t.string, t.special(t.string), t.character], color: "#ba2121" },
  { tag: t.escape, color: "#aa5d1f", fontWeight: "bold" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#408080", fontStyle: "italic" },
  { tag: [t.function(t.definition(t.variableName)), t.definition(t.className)], color: "#0000ff" },
  { tag: t.standard(t.variableName), color: "#008000" },
  { tag: [t.propertyName, t.function(t.propertyName)], color: "#0055aa" },
  { tag: [t.meta, t.annotation], color: "#aa22ff" },
  { tag: t.punctuation, color: "#0055aa" },
  { tag: [t.bracket, t.paren, t.squareBracket, t.brace], color: "#999977" },
  { tag: t.invalid, color: "#ff0000" },
]);

const jupyterTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "#212121", fontSize: "var(--jp-code-font-size)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--jp-code-font-family)", lineHeight: "var(--jp-code-line-height)" },
    ".cm-content": { padding: "4px 0", caretColor: "#000" },
    ".cm-line": { padding: "0 4px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#000", borderLeftWidth: "1px" },
    ".cm-placeholder": { color: "#9e9e9e", fontStyle: "normal" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "#d9d9d9",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "#d7d4f0",
    },
    ".cm-matchingBracket": { backgroundColor: "transparent", color: "#00b700", outline: "none", fontWeight: "bold" },
    ".cm-nonmatchingBracket": { backgroundColor: "transparent", color: "#aa2222" },
  },
  { dark: false },
);

// Tags selected text with .cm-revealSelection so masked editors can still show it.
const revealSelectionMark = Decoration.mark({ class: "cm-revealSelection" });

function selectionDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of state.selection.ranges) {
    if (!range.empty) builder.add(range.from, range.to, revealSelectionMark);
  }
  return builder.finish();
}

const markSelectionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = selectionDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) this.decorations = selectionDecorations(update.state);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

interface Props {
  value: string;
  onChange?: (value: string) => void;
  language?: "python" | "text";
  readOnly?: boolean;
  placeholder?: string;
  onRun?: () => void;
  onCreate?: (view: EditorView) => void;
  markSelection?: boolean;
}

export default function CellEditor({ value, onChange, language = "text", readOnly, placeholder, onRun, onCreate, markSelection }: Props) {
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const extensions = useMemo(() => {
    const runKey = () => {
      onRunRef.current?.();
      return true;
    };
    return [
      jupyterTheme,
      syntaxHighlighting(jupyterHighlight),
      ...(language === "python" ? [python()] : [EditorView.lineWrapping]),
      ...(markSelection ? [markSelectionPlugin] : []),
      Prec.highest(
        keymap.of([
          { key: "Shift-Enter", run: runKey },
          { key: "Mod-Enter", run: runKey },
        ]),
      ),
    ];
  }, [language, markSelection]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      editable={!readOnly}
      readOnly={readOnly}
      placeholder={placeholder}
      indentWithTab
      onCreateEditor={onCreate}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        closeBrackets: language === "python",
        bracketMatching: true,
        searchKeymap: false,
      }}
    />
  );
}
