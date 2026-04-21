import type { DiffHunk, DiffLine } from "@shared/types";

// Build a unified-diff patch that contains only a single file and a single
// hunk. `git apply --cached` understands this format directly, which is how
// hunk-level staging gets implemented.
export function buildHunkPatch(filePath: string, hunk: DiffHunk, oldPath?: string): string {
  const old = oldPath ?? filePath;
  const header = [
    `diff --git a/${old} b/${filePath}`,
    `--- a/${old}`,
    `+++ b/${filePath}`,
  ].join("\n");
  const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  const body = hunk.lines.map(lineToPatchLine).join("\n");
  return `${header}\n${hunkHeader}\n${body}\n`;
}

// Build a patch from an arbitrary subset of lines within a hunk. Unselected
// add/del lines are either dropped or converted to context so the resulting
// patch is still valid.
export function buildLinePatch(
  filePath: string,
  hunk: DiffHunk,
  selectedIndexes: Set<number>,
  oldPath?: string,
): string | null {
  const old = oldPath ?? filePath;

  // Build the reconstructed hunk:
  //   - selected add/del lines are kept as-is
  //   - unselected del lines become context (they stay in both old + new)
  //   - unselected add lines are dropped (they exist in neither)
  const newLines: DiffLine[] = [];
  let addedCount = 0;
  let delCount = 0;
  let contextCount = 0;
  let anySelected = false;

  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    const isSelected = selectedIndexes.has(i);
    if (line.type === "context") {
      newLines.push(line);
      contextCount++;
    } else if (line.type === "add") {
      if (isSelected) {
        newLines.push(line);
        addedCount++;
        anySelected = true;
      }
      // else: drop unselected additions
    } else {
      // del line
      if (isSelected) {
        newLines.push(line);
        delCount++;
        anySelected = true;
      } else {
        // Convert to context — the line is present in both old and new.
        newLines.push({ type: "context", content: line.content });
        contextCount++;
      }
    }
  }

  if (!anySelected) return null;

  const oldLines = contextCount + delCount;
  const newLinesCount = contextCount + addedCount;

  const header = [
    `diff --git a/${old} b/${filePath}`,
    `--- a/${old}`,
    `+++ b/${filePath}`,
  ].join("\n");
  const hunkHeader = `@@ -${hunk.oldStart},${oldLines} +${hunk.newStart},${newLinesCount} @@`;
  const body = newLines.map(lineToPatchLine).join("\n");
  return `${header}\n${hunkHeader}\n${body}\n`;
}

function lineToPatchLine(l: DiffLine): string {
  const prefix = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
  return prefix + l.content;
}
