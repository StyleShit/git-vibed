import type { Commit } from "../../src/shared/types.js";

// Parses git log output produced with the format string:
//   %H\x01%P\x01%an\x01%ae\x01%at\x01%D\x01%s\x01%b\x02
// The \x02 (record separator) terminates each commit so subjects/bodies
// containing newlines don't corrupt parsing.
export function parseGitLog(raw: string): Commit[] {
  if (!raw) return [];
  const records = raw.split("\x02").filter((r) => r.trim().length > 0);
  return records.map((record) => {
    const trimmed = record.startsWith("\n") ? record.slice(1) : record;
    const [hash, parents, author, email, timestamp, decorations, subject = "", body = ""] =
      trimmed.split("\x01");
    return {
      hash: hash?.trim() ?? "",
      parents: parents ? parents.trim().split(/\s+/).filter(Boolean) : [],
      author: author ?? "",
      email: email ?? "",
      timestamp: Number(timestamp) || 0,
      subject: subject.trim(),
      body: body.trim() || undefined,
      refs: parseDecorations(decorations ?? ""),
    };
  });
}

function parseDecorations(decoration: string): string[] {
  if (!decoration.trim()) return [];
  return decoration
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      // `git log --decorate=full` emits refs under their full paths
      // (refs/heads/…, refs/remotes/…, refs/tags/…). Normalize those to
      // the same short shape the renderer already assumes — otherwise
      // the ref badge sees `refs/remotes/origin/main`, strips the first
      // "refs/" segment, and renders a broken label.
      if (d.startsWith("HEAD -> ")) {
        const rest = d.slice("HEAD -> ".length);
        return stripRefPrefix(rest);
      }
      if (d.startsWith("tag: ")) return `tag:${stripRefPrefix(d.slice("tag: ".length))}`;
      if (d.startsWith("refs/tags/")) return `tag:${d.slice("refs/tags/".length)}`;
      return stripRefPrefix(d);
    });
}

function stripRefPrefix(ref: string): string {
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  if (ref.startsWith("refs/remotes/")) return ref.slice("refs/remotes/".length);
  if (ref.startsWith("refs/tags/")) return ref.slice("refs/tags/".length);
  return ref;
}

// Parse a unified diff into FileDiffs (one per file section).
export interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: Array<{ type: "context" | "add" | "del"; content: string; oldLineNo?: number; newLineNo?: number }>;
}

export interface ParsedFileDiff {
  path: string;
  oldPath?: string;
  binary: boolean;
  hunks: ParsedHunk[];
  raw: string;
}

export function parseUnifiedDiff(raw: string): ParsedFileDiff[] {
  if (!raw) return [];
  const files: ParsedFileDiff[] = [];
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("diff --git ")) {
      i++;
      continue;
    }
    const start = i;
    const header = lines[i];
    // paths: diff --git a/PATH b/PATH
    const m = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
    const oldPath = m?.[1];
    const newPath = m?.[2] ?? oldPath ?? "";
    i++;
    let binary = false;
    // Skip metadata until the first @@ hunk header or end of file section.
    while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git ")) {
      if (lines[i].startsWith("Binary files ")) binary = true;
      i++;
    }
    const hunks: ParsedHunk[] = [];
    while (i < lines.length && lines[i].startsWith("@@")) {
      const hunkHeader = lines[i];
      const hunkMatch = hunkHeader.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!hunkMatch) {
        i++;
        continue;
      }
      const oldStart = Number(hunkMatch[1]);
      const oldLines = Number(hunkMatch[2] ?? 1);
      const newStart = Number(hunkMatch[3]);
      const newLines = Number(hunkMatch[4] ?? 1);
      const hunkLines: ParsedHunk["lines"] = [];
      i++;
      let oldLineNo = oldStart;
      let newLineNo = newStart;
      while (
        i < lines.length &&
        !lines[i].startsWith("@@") &&
        !lines[i].startsWith("diff --git ")
      ) {
        const ln = lines[i];
        if (ln.startsWith("+")) {
          hunkLines.push({ type: "add", content: ln.slice(1), newLineNo: newLineNo++ });
        } else if (ln.startsWith("-")) {
          hunkLines.push({ type: "del", content: ln.slice(1), oldLineNo: oldLineNo++ });
        } else if (ln.startsWith(" ")) {
          hunkLines.push({
            type: "context",
            content: ln.slice(1),
            oldLineNo: oldLineNo++,
            newLineNo: newLineNo++,
          });
        } else if (ln.startsWith("\\")) {
          // "\ No newline at end of file" — attach to previous line conceptually.
        } else {
          // Unknown prefix: stop the hunk rather than misparse.
          break;
        }
        i++;
      }
      hunks.push({ oldStart, oldLines, newStart, newLines, header: hunkHeader, lines: hunkLines });
    }
    const rawSection = lines.slice(start, i).join("\n");
    files.push({ path: newPath, oldPath: oldPath !== newPath ? oldPath : undefined, binary, hunks, raw: rawSection });
  }
  return files;
}
