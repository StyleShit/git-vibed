import { diff3Merge } from "node-diff3";
import type { ConflictRegion } from "@shared/types";

// Run a line-level three-way merge using node-diff3. We split into lines
// manually so we can preserve line-terminators in the final join without
// loss.
export function threeWayMerge(
  ours: string,
  base: string,
  theirs: string,
): ConflictRegion[] {
  const oursLines = ours.split("\n");
  const baseLines = base.split("\n");
  const theirsLines = theirs.split("\n");
  const result = diff3Merge(oursLines, baseLines, theirsLines, {
    excludeFalseConflicts: true,
  });
  const regions: ConflictRegion[] = [];
  for (const r of result) {
    if ("ok" in r && r.ok) {
      regions.push({ kind: "ok", resolved: r.ok });
    } else if ("conflict" in r && r.conflict) {
      regions.push({
        kind: "conflict",
        ours: r.conflict.a,
        base: r.conflict.o,
        theirs: r.conflict.b,
      });
    }
  }
  return regions;
}

// Apply all non-conflicting regions and return the merged body + a list of
// remaining conflicts. Conflicts get a resolved = undefined marker so the
// UI knows to keep them highlighted.
export function applyNonConflicting(regions: ConflictRegion[]): {
  resolved: ConflictRegion[];
  conflictsRemaining: number;
} {
  let conflictsRemaining = 0;
  const resolved = regions.map((r) => {
    if (r.kind === "ok") return r;
    conflictsRemaining++;
    return { ...r };
  });
  return { resolved, conflictsRemaining };
}

// Magic-wand second pass: try to auto-resolve simple conflicts.
//   1. If only one side changed from base -> take that side.
//   2. If both sides made identical changes -> take either.
//   3. If a single-line conflict can be resolved at the word level -> use
//      the word-level merge result.
export function magicWand(regions: ConflictRegion[]): {
  resolved: ConflictRegion[];
  conflictsRemaining: number;
} {
  let conflictsRemaining = 0;
  const out = regions.map((r): ConflictRegion => {
    if (r.kind === "ok") return r;

    const ours = r.ours ?? [];
    const base = r.base ?? [];
    const theirs = r.theirs ?? [];

    // Rule 1: only one side changed.
    if (arrayEq(ours, base)) {
      return { kind: "ok", resolved: theirs };
    }
    if (arrayEq(theirs, base)) {
      return { kind: "ok", resolved: ours };
    }
    // Rule 2: identical changes on both sides.
    if (arrayEq(ours, theirs)) {
      return { kind: "ok", resolved: ours };
    }
    // Rule 3: single-line word-level merge.
    if (ours.length === 1 && theirs.length === 1 && base.length <= 1) {
      const baseLine = base[0] ?? "";
      const merged = tryWordLevelMerge(baseLine, ours[0], theirs[0]);
      if (merged !== null) {
        return { kind: "ok", resolved: [merged] };
      }
    }
    conflictsRemaining++;
    return r;
  });
  return { resolved: out, conflictsRemaining };
}

// Accept all from one side (useful as a bulk action).
export function acceptAll(
  regions: ConflictRegion[],
  side: "ours" | "theirs",
): ConflictRegion[] {
  return regions.map((r): ConflictRegion => {
    if (r.kind === "ok") return r;
    return { kind: "ok", resolved: (side === "ours" ? r.ours : r.theirs) ?? [] };
  });
}

// Flatten regions into a single string body. Conflicts that remain unresolved
// are emitted using standard git conflict markers so the file is still usable
// if the user aborts out.
export function regionsToString(regions: ConflictRegion[]): string {
  const out: string[] = [];
  for (const r of regions) {
    if (r.kind === "ok") {
      out.push(...(r.resolved ?? []));
    } else {
      out.push("<<<<<<< ours");
      out.push(...(r.ours ?? []));
      out.push("=======");
      out.push(...(r.theirs ?? []));
      out.push(">>>>>>> theirs");
    }
  }
  return out.join("\n");
}

function tryWordLevelMerge(
  baseLine: string,
  oursLine: string,
  theirsLine: string,
): string | null {
  const tokenize = (s: string): string[] => s.match(/\S+|\s+/g) ?? [];
  const result = diff3Merge(tokenize(oursLine), tokenize(baseLine), tokenize(theirsLine), {
    excludeFalseConflicts: true,
  });
  if (result.some((r) => "conflict" in r && r.conflict)) return null;
  return result
    .flatMap((r) => ("ok" in r && r.ok ? r.ok : []))
    .join("");
}

function arrayEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
