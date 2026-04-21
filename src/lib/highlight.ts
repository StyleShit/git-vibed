import hljs from "highlight.js/lib/core";

// Pick just the languages we care about. Loading the full hljs bundle adds
// ~600KB; the "common" bundle is still big, so we register explicitly to
// keep the renderer lean. Unregistered extensions fall through to plaintext.
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml"; // HTML / JSX / TSX
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import ruby from "highlight.js/lib/languages/ruby";
import sql from "highlight.js/lib/languages/sql";
import markdown from "highlight.js/lib/languages/markdown";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini"; // toml fallback
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import diff from "highlight.js/lib/languages/diff";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("python", python);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("java", java);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("php", php);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("diff", diff);

const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "dockerfile",
  toml: "ini",
  ini: "ini",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  diff: "diff",
  patch: "diff",
};

export function detectLanguage(filePath: string): string | null {
  // Special-case names that don't have conventional extensions.
  const base = filePath.split(/[\\/]/).pop() ?? "";
  if (/^Dockerfile(\..*)?$/.test(base)) return "dockerfile";
  if (/^Makefile$/.test(base)) return "bash";
  const dot = base.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

// Highlight a single line of code as inline HTML. Falls back to an HTML-
// escaped plain span if the language isn't recognized or highlighting
// fails. hljs handles multi-line state well when we feed it one line at a
// time because we pass the `ignoreIllegals` flag and highlighted tokens
// close cleanly per-line for most languages we care about.
export function highlightLine(content: string, lang: string | null): string {
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(content);
  try {
    return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(content);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
