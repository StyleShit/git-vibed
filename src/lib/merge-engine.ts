import { diff3Merge, diff3MergeRegions, diffComm } from "node-diff3";
import type { ConflictRegion, LineDecision } from "@shared/types";

// Shape of a stable/unstable region returned by diff3MergeRegions. The
// library isn't TS-typed so we redeclare just the fields we read.
type RawStable = {
  stable: true;
  buffer: "o" | "a" | "b";
  bufferStart: number;
  bufferLength: number;
  bufferContent: string[];
};
type RawUnstable = {
  stable: false;
  aStart: number;
  aLength: number;
  aContent: string[];
  oStart: number;
  oLength: number;
  oContent: string[];
  bStart: number;
  bLength: number;
  bContent: string[];
};
type RawRegion = RawStable | RawUnstable;

// Conflict chunks now carry per-line decisions so the user can accept or
// drop individual lines from either side (WebStorm-style). A conflict is
// considered "resolved" once every line on both sides has been decided;
// the final content is the sequence of accepted ours-lines followed by
// accepted theirs-lines. Regions whose kind is already "ok" come straight
// from diff3 (no divergence); they're passed through unchanged.

// ---- Parsing -------------------------------------------------------------

export function threeWayMerge(
  ours: string,
  base: string,
  theirs: string,
): ConflictRegion[] {
  // We use diff3MergeRegions (the lower-level output) rather than diff3Merge
  // so we can see each stable region's source buffer — that's how we know
  // whether an ok chunk's lines exist in ours, in theirs, or in both. Without
  // that distinction, the ours/theirs panes drift out of sync with the result
  // pane whenever one side added or removed lines.
  const raw = diff3MergeRegions(
    ours.split("\n"),
    base.split("\n"),
    theirs.split("\n"),
  ) as RawRegion[];
  const regions: ConflictRegion[] = [];
  for (const r of raw) {
    if (r.stable) {
      const content = r.bufferContent;
      const len = r.bufferLength;
      if (r.buffer === "o") {
        regions.push({
          kind: "ok",
          resolved: content,
          oursSpan: len,
          theirsSpan: len,
          source: "both",
        });
      } else if (r.buffer === "a") {
        regions.push({
          kind: "ok",
          resolved: content,
          oursSpan: len,
          theirsSpan: 0,
          source: "ours",
        });
      } else {
        // buffer === "b"
        regions.push({
          kind: "ok",
          resolved: content,
          oursSpan: 0,
          theirsSpan: len,
          source: "theirs",
        });
      }
      continue;
    }
    // Unstable (conflict). Fold away the cases that excludeFalseConflicts
    // used to handle for us inline: if one side matches base, the other
    // wins; if both sides made the identical change, either wins.
    const a = r.aContent;
    const o = r.oContent;
    const b = r.bContent;
    if (arrayEq(a, o)) {
      regions.push({
        kind: "ok",
        resolved: b,
        oursSpan: a.length,
        theirsSpan: b.length,
        source: "both",
      });
      continue;
    }
    if (arrayEq(b, o)) {
      regions.push({
        kind: "ok",
        resolved: a,
        oursSpan: a.length,
        theirsSpan: b.length,
        source: "both",
      });
      continue;
    }
    if (arrayEq(a, b)) {
      regions.push({
        kind: "ok",
        resolved: a,
        oursSpan: a.length,
        theirsSpan: b.length,
        source: "both",
      });
      continue;
    }
    regions.push({
      kind: "conflict",
      ours: a,
      base: o,
      theirs: b,
      oursDecisions: a.map(() => null),
      theirsDecisions: b.map(() => null),
      oursSpan: a.length,
      theirsSpan: b.length,
    });
  }
  return regions;
}

// ---- Inspection ----------------------------------------------------------

export function isFullyDecided(r: ConflictRegion): boolean {
  if (r.kind === "ok") return true;
  const os = r.oursDecisions ?? [];
  const ts = r.theirsDecisions ?? [];
  return os.every((v) => v !== null) && ts.every((v) => v !== null);
}

// Accepted lines for a conflict region, in the order they'd appear in the
// result pane (all accepted ours first, then all accepted theirs).
export function acceptedLines(r: ConflictRegion): string[] {
  if (r.kind === "ok") return r.resolved ?? [];
  const out: string[] = [];
  const ours = r.ours ?? [];
  const theirs = r.theirs ?? [];
  const oInc = r.oursDecisions ?? [];
  const tInc = r.theirsDecisions ?? [];
  for (let i = 0; i < ours.length; i++) if (oInc[i] === true) out.push(ours[i]);
  for (let i = 0; i < theirs.length; i++) if (tInc[i] === true) out.push(theirs[i]);
  return out;
}

function pendingCount(r: ConflictRegion): number {
  if (r.kind === "ok") return 0;
  const os = r.oursDecisions ?? [];
  const ts = r.theirsDecisions ?? [];
  let n = 0;
  for (const v of os) if (v === null) n++;
  for (const v of ts) if (v === null) n++;
  return n;
}

// How many lines this region occupies in the result pane. A resolved
// region is just its content. A partially-decided conflict shows the
// accepted lines so far plus one placeholder row per pending line so the
// "hole" stays visible until the user fills it in.
export function conflictHeight(r: ConflictRegion): number {
  if (r.kind === "ok") return (r.resolved ?? []).length;
  const accepted = acceptedLines(r).length;
  if (isFullyDecided(r)) return Math.max(accepted, 0);
  // Keep at least one row so the chunk is still visible even when all
  // decisions so far have been "reject".
  return Math.max(accepted + pendingCount(r), 1);
}

export function regionsToString(regions: ConflictRegion[]): string {
  const out: string[] = [];
  for (const r of regions) {
    if (r.kind === "ok") {
      out.push(...(r.resolved ?? []));
    } else {
      const accepted = acceptedLines(r);
      out.push(...accepted);
      const placeholders = conflictHeight(r) - accepted.length;
      for (let i = 0; i < placeholders; i++) out.push("");
    }
  }
  return out.join("\n");
}

// ---- Per-line & per-side edits ------------------------------------------

// Set every line on one side of a chunk to accept (true) or reject (false).
export function setSideDecision(
  regions: ConflictRegion[],
  idx: number,
  side: "ours" | "theirs",
  accept: boolean,
): ConflictRegion[] {
  return regions.map((r, i): ConflictRegion => {
    if (i !== idx || r.kind !== "conflict") return r;
    const key = side === "ours" ? "oursDecisions" : "theirsDecisions";
    const len = (side === "ours" ? r.ours : r.theirs)?.length ?? 0;
    return { ...r, [key]: new Array<LineDecision>(len).fill(accept) };
  });
}

// Cycle a single line's decision: pending → include → exclude → include → …
export function cycleLineDecision(
  regions: ConflictRegion[],
  idx: number,
  side: "ours" | "theirs",
  lineIdx: number,
): ConflictRegion[] {
  return regions.map((r, i): ConflictRegion => {
    if (i !== idx || r.kind !== "conflict") return r;
    const key = side === "ours" ? "oursDecisions" : "theirsDecisions";
    const src = (r[key] ?? []) as LineDecision[];
    const arr = [...src];
    if (lineIdx < 0 || lineIdx >= arr.length) return r;
    const cur = arr[lineIdx];
    arr[lineIdx] = cur === true ? false : true; // null/false → true, true → false
    return { ...r, [key]: arr };
  });
}

// ---- Bulk resolution helpers --------------------------------------------

// Accept every line of one side across all unresolved chunks. The chunks
// get their per-line decisions filled (that side = all-accept, the other
// side = all-reject) so the user can still override individually.
export function acceptAll(
  regions: ConflictRegion[],
  side: "ours" | "theirs",
): ConflictRegion[] {
  return regions.map((r): ConflictRegion => {
    if (r.kind === "ok") return r;
    const ours = r.ours ?? [];
    const theirs = r.theirs ?? [];
    return {
      ...r,
      oursDecisions: ours.map(() => side === "ours"),
      theirsDecisions: theirs.map(() => side === "theirs"),
    };
  });
}

// Apply the "obviously safe" resolutions — conflicts where one side didn't
// actually diverge from base, or where both sides produced identical
// content. Chunks that require judgement are left untouched.
export function applySafe(regions: ConflictRegion[]): {
  resolved: ConflictRegion[];
  conflictsRemaining: number;
} {
  let conflictsRemaining = 0;
  const out = regions.map((r): ConflictRegion => {
    if (r.kind === "ok") return r;
    if (isFullyDecided(r)) return r;

    const ours = r.ours ?? [];
    const base = r.base ?? [];
    const theirs = r.theirs ?? [];

    // Only one side changed → take the other side.
    if (arrayEq(ours, base)) return fill(r, { oursAll: false, theirsAll: true });
    if (arrayEq(theirs, base)) return fill(r, { oursAll: true, theirsAll: false });
    // Both sides made identical changes → take ours (arbitrary; content is
    // the same either way).
    if (arrayEq(ours, theirs)) return fill(r, { oursAll: true, theirsAll: false });

    conflictsRemaining++;
    return r;
  });
  return { resolved: out, conflictsRemaining };
}

// Magic wand: run applySafe, then try token-level diff3 on anything that's
// still in conflict. If the token-level merge produces no conflicts we use
// that result; otherwise the chunk is left for the user. Token-level
// merging catches real-world cases where ours and theirs touched the same
// line but in non-overlapping ways (e.g. added arguments on different
// sides of a function signature).
export function magicWand(regions: ConflictRegion[]): {
  resolved: ConflictRegion[];
  conflictsRemaining: number;
} {
  const afterSafe = applySafe(regions).resolved;
  let conflictsRemaining = 0;
  const out = afterSafe.map((r): ConflictRegion => {
    if (r.kind === "ok" || isFullyDecided(r)) return r;
    const ours = (r.ours ?? []).join("\n");
    const base = (r.base ?? []).join("\n");
    const theirs = (r.theirs ?? []).join("\n");
    const merged = tryTokenMerge(base, ours, theirs);
    if (merged !== null) {
      // Convert to "ok" so the chunk vanishes from the conflict list. We
      // preserve the per-side spans so the pane line counters stay in
      // step — token merging never changes how many lines each source
      // file contributes.
      return {
        kind: "ok",
        resolved: merged.split("\n"),
        oursSpan: r.oursSpan,
        theirsSpan: r.theirsSpan,
        source: "both",
      };
    }
    conflictsRemaining++;
    return r;
  });
  return { resolved: out, conflictsRemaining };
}

function tryTokenMerge(base: string, ours: string, theirs: string): string | null {
  const tokenize = (s: string): string[] => s.match(/\s+|\S+/g) ?? [];
  const out = diff3Merge(tokenize(ours), tokenize(base), tokenize(theirs), {
    excludeFalseConflicts: true,
  });
  if (out.some((r) => "conflict" in r && r.conflict)) return null;
  return out.flatMap((r) => ("ok" in r && r.ok ? r.ok : [])).join("");
}

// ---- Per-line diff against base (for red/green coloring) ----------------

export type LineMark = "unchanged" | "added";

// Per-line classification of a side-chunk vs its base. Every line in
// `side` is tagged either "unchanged" (appears identically in base) or
// "added" (new to this side relative to base). Lines that base had but
// side removed cannot be shown inline since they're not in side.
type DiffCommChunk =
  | { common: string[] }
  | { buffer1: string[]; buffer2: string[] };
export function perLineDiff(base: string[], side: string[]): LineMark[] {
  const chunks = diffComm(base, side) as DiffCommChunk[];
  const out: LineMark[] = [];
  for (const ch of chunks) {
    if ("common" in ch) {
      for (let i = 0; i < ch.common.length; i++) out.push("unchanged");
    } else {
      // `buffer2` holds the `side` divergent lines (buffer1 = base side).
      for (let i = 0; i < ch.buffer2.length; i++) out.push("added");
    }
  }
  return out;
}

// ---- Internals -----------------------------------------------------------

function fill(
  r: ConflictRegion,
  { oursAll, theirsAll }: { oursAll: boolean; theirsAll: boolean },
): ConflictRegion {
  return {
    ...r,
    oursDecisions: (r.ours ?? []).map(() => oursAll),
    theirsDecisions: (r.theirs ?? []).map(() => theirsAll),
  };
}

function arrayEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
