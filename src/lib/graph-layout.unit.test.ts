import { describe, expect, it } from "vitest";
import type { Commit } from "@shared/types";
import { layoutCommits } from "./graph-layout";

function commit(hash: string, parents: string[] = []): Commit {
  return {
    hash,
    parents,
    author: "A",
    email: "a@b",
    timestamp: 0,
    subject: hash,
    refs: [],
  };
}

describe("layoutCommits", () => {
  it("returns an empty layout for no commits", () => {
    const l = layoutCommits([]);
    expect(l.nodes).toEqual([]);
    expect(l.edges).toEqual([]);
    expect(l.laneCount).toBe(0);
  });

  it("lays a linear history on a single lane with one edge per parent link", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a")];
    const l = layoutCommits(commits);
    expect(l.nodes.map((n) => n.lane)).toEqual([0, 0, 0]);
    expect(l.nodes.map((n) => n.row)).toEqual([0, 1, 2]);
    expect(l.laneCount).toBe(1);
    expect(l.edges).toHaveLength(2);
    // All edges should stay on lane 0 for a linear history.
    for (const e of l.edges) {
      expect(e.fromLane).toBe(0);
      expect(e.toLane).toBe(0);
    }
  });

  it("opens a second lane for a merge's second parent", () => {
    // m has two parents: a (first-parent) and b (merge-parent).
    const commits = [
      commit("m", ["a", "b"]),
      commit("a", []),
      commit("b", []),
    ];
    const l = layoutCommits(commits);
    expect(l.laneCount).toBeGreaterThanOrEqual(2);
    const m = l.nodes.find((n) => n.commit.hash === "m")!;
    const a = l.nodes.find((n) => n.commit.hash === "a")!;
    const b = l.nodes.find((n) => n.commit.hash === "b")!;
    // Merge commit keeps its own lane; first parent inherits it.
    expect(a.lane).toBe(m.lane);
    // Second parent lands in a different lane.
    expect(b.lane).not.toBe(m.lane);
  });

  it("does not emit edges to parents outside the window", () => {
    // `b`'s parent `a` isn't in the window — no edge should reach it.
    const l = layoutCommits([commit("b", ["a"])]);
    expect(l.edges).toEqual([]);
    expect(l.nodes).toHaveLength(1);
  });

  it("handles an octopus merge (3+ parents) by opening one lane per merge parent", () => {
    const commits = [
      commit("m", ["a", "b", "c"]),
      commit("a"),
      commit("b"),
      commit("c"),
    ];
    const l = layoutCommits(commits);
    // One lane per distinct line of descent.
    const lanes = new Set(l.nodes.map((n) => n.lane));
    expect(lanes.size).toBe(3);
    expect(l.laneCount).toBe(3);
  });

  it("gives each node a color drawn from the palette", () => {
    const l = layoutCommits([commit("a")]);
    expect(l.nodes[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
