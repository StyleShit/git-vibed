import type { Branch } from "@shared/types";

// A folder is an internal node; a leaf holds a Branch. A node can be both —
// `feature` might exist as a standalone branch AND have `feature/login` etc.
// nested under it.
export interface BranchTreeNode {
  name: string;
  fullPath: string;
  branch: Branch | null;
  children: BranchTreeNode[];
}

// Build a nested tree from a flat branch list, splitting names on "/".
// Siblings are sorted with folders first, then leaves, alphabetical within each.
export function buildBranchTree(branches: Branch[]): BranchTreeNode {
  const root: BranchTreeNode = { name: "", fullPath: "", branch: null, children: [] };
  const byPath = new Map<string, BranchTreeNode>();
  byPath.set("", root);

  for (const branch of branches) {
    const parts = branch.name.split("/").filter(Boolean);
    let cursor = root;
    let accum = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accum = accum ? `${accum}/${part}` : part;
      let child = byPath.get(accum);
      if (!child) {
        child = { name: part, fullPath: accum, branch: null, children: [] };
        cursor.children.push(child);
        byPath.set(accum, child);
      }
      cursor = child;
      if (i === parts.length - 1) cursor.branch = branch;
    }
  }

  sortRecursive(root);
  return root;
}

function sortRecursive(node: BranchTreeNode) {
  node.children.sort((a, b) => {
    const aFolder = a.children.length > 0;
    const bFolder = b.children.length > 0;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) sortRecursive(c);
}

// Count leaf branches at or below this node. Used for the "(n)" badge on
// folder rows.
export function countBranches(node: BranchTreeNode): number {
  let n = node.branch ? 1 : 0;
  for (const c of node.children) n += countBranches(c);
  return n;
}

// True if this subtree contains any branch whose name matches the filter.
// Matching is case-insensitive substring against the full branch name.
export function matchesFilter(node: BranchTreeNode, filterLC: string): boolean {
  if (!filterLC) return true;
  if (node.branch && node.branch.name.toLowerCase().includes(filterLC)) return true;
  for (const c of node.children) if (matchesFilter(c, filterLC)) return true;
  return false;
}
