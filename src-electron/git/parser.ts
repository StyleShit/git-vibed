import type { Commit } from "../../src/shared/types.js";

// Parses git log output produced with the format string:
//   %H\x01%P\x01%an\x01%ae\x01%at\x01%D\x01%s\x02
// The \x02 (record separator) terminates each commit so subjects containing
// newlines don't corrupt parsing.
export function parseGitLog(raw: string): Commit[] {
  if (!raw) return [];
  const records = raw.split("\x02").filter((r) => r.trim().length > 0);
  return records.map((record) => {
    const trimmed = record.startsWith("\n") ? record.slice(1) : record;
    const [hash, parents, author, email, timestamp, decorations, subject = ""] =
      trimmed.split("\x01");
    return {
      hash: hash?.trim() ?? "",
      parents: parents ? parents.trim().split(/\s+/).filter(Boolean) : [],
      author: author ?? "",
      email: email ?? "",
      timestamp: Number(timestamp) || 0,
      subject: subject.trim(),
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
      // Normalize "HEAD -> main" and "tag: v1.0" into their ref portions.
      if (d.startsWith("HEAD -> ")) return d.slice("HEAD -> ".length);
      if (d.startsWith("tag: ")) return `tag:${d.slice("tag: ".length)}`;
      return d;
    });
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
