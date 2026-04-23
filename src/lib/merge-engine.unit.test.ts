import { describe, expect, it } from "vitest";
import {
  threeWayMerge,
  acceptedLines,
  isFullyDecided,
  setSideDecision,
  cycleLineDecision,
  acceptAll,
  applySafe,
  regionsToString,
} from "./merge-engine";

describe("threeWayMerge", () => {
  it("returns a single ok region when ours == base == theirs", () => {
    const regs = threeWayMerge("a\nb\nc", "a\nb\nc", "a\nb\nc");
    expect(regs).toHaveLength(1);
    expect(regs[0].kind).toBe("ok");
  });

  it("returns ok when only ours changed (theirs unchanged)", () => {
    const regs = threeWayMerge("a\nx\nc", "a\nb\nc", "a\nb\nc");
    // Every region should be ok — no user decision needed.
    expect(regs.every((r) => r.kind === "ok")).toBe(true);
    expect(regionsToString(regs).split("\n")).toEqual(["a", "x", "c"]);
  });

  it("returns ok when only theirs changed (ours unchanged)", () => {
    const regs = threeWayMerge("a\nb\nc", "a\nb\nc", "a\ny\nc");
    expect(regs.every((r) => r.kind === "ok")).toBe(true);
    expect(regionsToString(regs).split("\n")).toEqual(["a", "y", "c"]);
  });

  it("returns ok when ours and theirs made the identical edit", () => {
    const regs = threeWayMerge("a\nX\nc", "a\nb\nc", "a\nX\nc");
    expect(regs.every((r) => r.kind === "ok")).toBe(true);
    expect(regionsToString(regs).split("\n")).toEqual(["a", "X", "c"]);
  });

  it("surfaces a conflict region when ours and theirs diverge", () => {
    const regs = threeWayMerge("a\nours\nc", "a\nbase\nc", "a\ntheirs\nc");
    const conflicts = regs.filter((r) => r.kind === "conflict");
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(c.kind).toBe("conflict");
    if (c.kind === "conflict") {
      expect(c.ours).toEqual(["ours"]);
      expect(c.theirs).toEqual(["theirs"]);
      expect(c.oursDecisions).toEqual([null]);
      expect(c.theirsDecisions).toEqual([null]);
    }
  });
});

describe("applySafe", () => {
  it("resolves conflicts where only one side changed", () => {
    // Manually build a conflict region where ours==base — applySafe should
    // take theirs.
    const regs = threeWayMerge("a\nb\nc", "a\nb\nc", "a\nT\nc");
    const { resolved, conflictsRemaining } = applySafe(regs);
    expect(conflictsRemaining).toBe(0);
    expect(resolved.every((r) => r.kind === "ok")).toBe(true);
  });

  it("leaves truly divergent conflicts alone", () => {
    const regs = threeWayMerge("O", "B", "T");
    const { resolved, conflictsRemaining } = applySafe(regs);
    expect(conflictsRemaining).toBe(1);
    expect(resolved.some((r) => r.kind === "conflict")).toBe(true);
  });
});

describe("acceptAll", () => {
  it("fills every conflict chunk with a full decision on one side", () => {
    const regs = threeWayMerge("O", "B", "T");
    const filled = acceptAll(regs, "ours");
    expect(filled.every(isFullyDecided)).toBe(true);
    for (const r of filled) {
      if (r.kind !== "conflict") continue;
      expect(r.oursDecisions?.every((v) => v === true)).toBe(true);
      expect(r.theirsDecisions?.every((v) => v === false)).toBe(true);
    }
  });
});

describe("per-line edits", () => {
  it("setSideDecision flips a whole side to accept or reject", () => {
    const regs = threeWayMerge("o1\no2", "b", "t1\nt2");
    const idx = regs.findIndex((r) => r.kind === "conflict");
    const out = setSideDecision(regs, idx, "ours", true);
    const r = out[idx];
    expect(r.kind).toBe("conflict");
    if (r.kind === "conflict") {
      expect(r.oursDecisions).toEqual([true, true]);
      expect(r.theirsDecisions).toEqual([null, null]);
    }
  });

  it("cycleLineDecision toggles null → accept → reject → accept", () => {
    const regs = threeWayMerge("o1\no2", "b", "t1\nt2");
    const idx = regs.findIndex((r) => r.kind === "conflict");
    let out = cycleLineDecision(regs, idx, "ours", 0);
    expect((out[idx] as { oursDecisions: unknown[] }).oursDecisions[0]).toBe(true);
    out = cycleLineDecision(out, idx, "ours", 0);
    expect((out[idx] as { oursDecisions: unknown[] }).oursDecisions[0]).toBe(false);
    out = cycleLineDecision(out, idx, "ours", 0);
    expect((out[idx] as { oursDecisions: unknown[] }).oursDecisions[0]).toBe(true);
  });
});

describe("acceptedLines", () => {
  it("returns accepted ours-lines first, then theirs-lines", () => {
    const regs = threeWayMerge("o1\no2", "b", "t1\nt2");
    const idx = regs.findIndex((r) => r.kind === "conflict");
    let out = setSideDecision(regs, idx, "ours", true);
    out = setSideDecision(out, idx, "theirs", true);
    expect(acceptedLines(out[idx])).toEqual(["o1", "o2", "t1", "t2"]);
  });
});
