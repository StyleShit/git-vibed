import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// Point @monaco-editor/react at the bundled copy so it doesn't try to load
// Monaco from the jsdelivr CDN — our CSP blocks that.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

// Custom theme that mirrors the highlight.js "github-dark" palette used by
// the rest of the app (diff views, commit file diff, etc.) so syntax
// colors don't jump when the user opens the merge editor.
monaco.editor.defineTheme("git-vibed-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "c9d1d9", background: "0d1117" },
    { token: "comment", foreground: "8b949e", fontStyle: "italic" },
    { token: "keyword", foreground: "ff7b72" },
    { token: "keyword.control", foreground: "ff7b72" },
    { token: "storage", foreground: "ff7b72" },
    { token: "storage.type", foreground: "ff7b72" },
    { token: "operator", foreground: "ff7b72" },
    { token: "string", foreground: "a5d6ff" },
    { token: "string.escape", foreground: "a5d6ff" },
    { token: "regexp", foreground: "a5d6ff" },
    { token: "number", foreground: "79c0ff" },
    { token: "constant", foreground: "79c0ff" },
    { token: "constant.numeric", foreground: "79c0ff" },
    { token: "constant.language", foreground: "79c0ff" },
    { token: "attribute.name", foreground: "79c0ff" },
    { token: "attribute.value", foreground: "a5d6ff" },
    { token: "variable", foreground: "c9d1d9" },
    { token: "variable.parameter", foreground: "ffa657" },
    { token: "identifier", foreground: "c9d1d9" },
    { token: "type", foreground: "ffa657" },
    { token: "type.identifier", foreground: "ffa657" },
    { token: "class", foreground: "d2a8ff" },
    { token: "function", foreground: "d2a8ff" },
    { token: "tag", foreground: "7ee787" },
    { token: "delimiter", foreground: "c9d1d9" },
    { token: "delimiter.html", foreground: "7ee787" },
    { token: "metatag", foreground: "7ee787" },
    { token: "meta.tag", foreground: "7ee787" },
  ],
  colors: {
    "editor.background": "#0d1117",
    "editor.foreground": "#c9d1d9",
    "editor.lineHighlightBackground": "#161b2260",
    "editor.lineHighlightBorder": "#00000000",
    "editorLineNumber.foreground": "#484f58",
    "editorLineNumber.activeForeground": "#8b949e",
    "editor.selectionBackground": "#1f6feb4d",
    "editor.inactiveSelectionBackground": "#1f6feb20",
    "editorIndentGuide.background": "#161b22",
    "editorIndentGuide.activeBackground": "#30363d",
    "editorWhitespace.foreground": "#30363d",
    "editorCursor.foreground": "#c9d1d9",
    "editorGutter.background": "#0d1117",
    "scrollbarSlider.background": "#525252a0",
    "scrollbarSlider.hoverBackground": "#6b6b6ba0",
  },
});

loader.config({ monaco });
