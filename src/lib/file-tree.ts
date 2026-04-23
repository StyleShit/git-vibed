import type { FileChange } from "@shared/types";

export interface TreeNode {
  name: string;
  file?: FileChange;
  children: Map<string, TreeNode>;
}

// Build a path-segmented tree from a flat file list, then collapse
// single-child folder chains (e.g. "src/components/ui" renders as a
// single node rather than three nested folders).
export function buildTree(files: FileChange[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let child = node.children.get(p);
      if (!child) {
        child = { name: p, children: new Map() };
        node.children.set(p, child);
      }
      if (i === parts.length - 1) child.file = f;
      node = child;
    }
  }
  return collapseChains(root);
}

function collapseChains(node: TreeNode): TreeNode {
  const kids = [...node.children.values()];
  for (const child of kids) {
    collapseChains(child);
    while (!child.file && child.children.size === 1) {
      const [only] = child.children.values();
      if (only.file && only.children.size === 0) break;
      child.name = `${child.name}/${only.name}`;
      child.file = only.file;
      child.children = only.children;
    }
  }
  return node;
}
