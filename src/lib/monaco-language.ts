// Map a file path to the Monaco language id. Kept separate from the hljs
// mapping in ./highlight because Monaco uses different ids in a few places
// (shell vs bash, html vs xml).
const EXT_TO_MONACO: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  vue: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "dockerfile",
  toml: "ini",
  ini: "ini",
  c: "c",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  diff: "diff",
  patch: "diff",
  lua: "lua",
  r: "r",
  pl: "perl",
  scala: "scala",
};

export function monacoLanguageForPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  if (/^Dockerfile(\..*)?$/.test(base)) return "dockerfile";
  if (/^Makefile$/.test(base)) return "shell";
  const dot = base.lastIndexOf(".");
  if (dot === -1) return "plaintext";
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_MONACO[ext] ?? "plaintext";
}
