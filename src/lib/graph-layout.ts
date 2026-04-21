import type { Commit } from "@shared/types";

export interface GraphNode {
  commit: Commit;
  row: number;
  lane: number;
  color: string;
  parentPositions: Array<{ parentHash: string; lane: number }>;
}

export interface GraphEdge {
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  color: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  laneCount: number;
}

const PALETTE = [
  "#60a5fa", // blue-400
  "#f472b6", // pink-400
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
  "#a78bfa", // violet-400
  "#f87171", // red-400
  "#2dd4bf", // teal-400
  "#fb923c", // orange-400
  "#c084fc", // purple-400
  "#4ade80", // green-400
  "#38bdf8", // sky-400
  "#e879f9", // fuchsia-400
];

function pickColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// Assign each commit an (x = lane, y = row) position and generate edges to
// each parent. Commits are expected in the order git returns them (newest
// first / topological within branches).
export function layoutCommits(commits: Commit[]): GraphLayout {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // activeLanes[i] = hash the lane is currently expecting as its next commit.
  const activeLanes: Array<string | null> = [];
  // Track a stable color per lane so branches stay the same color vertically.
  const laneColors: string[] = [];
  // Index commits by hash for parent lookups.
  const byHash = new Map<string, Commit>();
  for (const c of commits) byHash.set(c.hash, c);

  let laneCount = 0;

  commits.forEach((commit, row) => {
    // Find or allocate this commit's lane.
    let lane = activeLanes.findIndex((h) => h === commit.hash);
    if (lane === -1) {
      // Commit hasn't been seen as a parent yet — open a new lane.
      const firstFree = activeLanes.findIndex((h) => h === null);
      if (firstFree === -1) {
        activeLanes.push(commit.hash);
        laneColors.push(pickColor(commit.hash));
        lane = activeLanes.length - 1;
      } else {
        activeLanes[firstFree] = commit.hash;
        laneColors[firstFree] = pickColor(commit.hash);
        lane = firstFree;
      }
    }
    const color = laneColors[lane];
    // Free this lane — we'll reassign for the first parent below.
    activeLanes[lane] = null;

    const parentPositions: GraphNode["parentPositions"] = [];
    commit.parents.forEach((parent, i) => {
      // Only render edges to parents that exist in our window.
      if (!byHash.has(parent)) return;

      if (i === 0) {
        // First parent inherits this commit's lane when possible.
        let pLane = activeLanes.findIndex((h) => h === parent);
        if (pLane === -1) {
          if (activeLanes[lane] === null) {
            activeLanes[lane] = parent;
            pLane = lane;
          } else {
            const firstFree = activeLanes.findIndex((h) => h === null);
            if (firstFree === -1) {
              activeLanes.push(parent);
              laneColors.push(color);
              pLane = activeLanes.length - 1;
            } else {
              activeLanes[firstFree] = parent;
              laneColors[firstFree] = color;
              pLane = firstFree;
            }
          }
        }
        parentPositions.push({ parentHash: parent, lane: pLane });
      } else {
        // Merge parents take their own new lane with a fresh color.
        let pLane = activeLanes.findIndex((h) => h === parent);
        if (pLane === -1) {
          const firstFree = activeLanes.findIndex((h) => h === null);
          if (firstFree === -1) {
            activeLanes.push(parent);
            laneColors.push(pickColor(parent));
            pLane = activeLanes.length - 1;
          } else {
            activeLanes[firstFree] = parent;
            laneColors[firstFree] = pickColor(parent);
            pLane = firstFree;
          }
        }
        parentPositions.push({ parentHash: parent, lane: pLane });
      }
    });

    if (activeLanes.length > laneCount) laneCount = activeLanes.length;

    nodes.push({ commit, row, lane, color, parentPositions });
  });

  // Compute edges once we know every node's row.
  const nodeByHash = new Map(nodes.map((n) => [n.commit.hash, n]));
  for (const n of nodes) {
    for (const pp of n.parentPositions) {
      const parentNode = nodeByHash.get(pp.parentHash);
      if (!parentNode) continue;
      edges.push({
        fromRow: n.row,
        fromLane: n.lane,
        toRow: parentNode.row,
        toLane: pp.lane,
        color: n.color,
      });
    }
  }

  return { nodes, edges, laneCount };
}
