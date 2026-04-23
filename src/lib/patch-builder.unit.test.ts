import { describe, expect, it } from "vitest";
import type { DiffHunk, DiffLine } from "@shared/types";
import { buildHunkPatch, buildLinePatch } from "./patch-builder";

function line(type: DiffLine["type"], content: string): DiffLine {
  return { type, content };
}

function hunkOf(lines: DiffLine[]): DiffHunk {
  const oldLines = lines.filter((l) => l.type !== "add").length;
  const newLines = lines.filter((l) => l.type !== "del").length;
  return {
    oldStart: 1,
    oldLines,
    newStart: 1,
    newLines,
    header: "@@ stub @@",
    lines,
  };
}

describe("buildHunkPatch", () => {
  it("emits a diff header + hunk header + body with the correct prefixes", () => {
    const hunk = hunkOf([
      line("context", "keep"),
      line("del", "old"),
      line("add", "new"),
    ]);
    const patch = buildHunkPatch("foo.ts", hunk);
    expect(patch).toBe(
      [
        "diff --git a/foo.ts b/foo.ts",
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,2 +1,2 @@",
        " keep",
        "-old",
        "+new",
        "",
      ].join("\n"),
    );
  });

  it("uses oldPath in the a/ header when the file was renamed", () => {
    const hunk = hunkOf([line("add", "x")]);
    const patch = buildHunkPatch("new.ts", hunk, "old.ts");
    expect(patch.startsWith("diff --git a/old.ts b/new.ts\n--- a/old.ts\n+++ b/new.ts\n")).toBe(true);
  });
});

describe("buildLinePatch", () => {
  it("returns null when no lines are selected", () => {
    const hunk = hunkOf([line("add", "a"), line("add", "b")]);
    expect(buildLinePatch("f.ts", hunk, new Set())).toBeNull();
  });

  it("drops unselected add lines", () => {
    const hunk = hunkOf([
      line("context", "keep"),
      line("add", "a"),
      line("add", "b"),
    ]);
    const patch = buildLinePatch("f.ts", hunk, new Set([1]));
    expect(patch).not.toBeNull();
    // Only the selected add survives; the unselected add is gone entirely.
    expect(patch!.includes("+a")).toBe(true);
    expect(patch!.includes("+b")).toBe(false);
    // old=1 (context), new=2 (context + kept add).
    expect(patch!.includes("@@ -1,1 +1,2 @@")).toBe(true);
  });

  it("converts unselected del lines into context so the patch stays valid", () => {
    const hunk = hunkOf([
      line("del", "x"),
      line("del", "y"),
    ]);
    const patch = buildLinePatch("f.ts", hunk, new Set([0]));
    expect(patch).not.toBeNull();
    // Selected del survives; unselected del becomes a context line.
    expect(patch!.split("\n")).toContain("-x");
    expect(patch!.split("\n")).toContain(" y");
    // old=2 (context + del), new=1 (just the context).
    expect(patch!.includes("@@ -1,2 +1,1 @@")).toBe(true);
  });

  it("keeps every selected line when everything is selected", () => {
    const hunk = hunkOf([
      line("context", "c"),
      line("del", "d"),
      line("add", "a"),
    ]);
    const all = new Set([0, 1, 2]);
    const patch = buildLinePatch("f.ts", hunk, all);
    const hunkPatch = buildHunkPatch("f.ts", hunk);
    expect(patch).toBe(hunkPatch);
  });
});
