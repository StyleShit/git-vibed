import { useMemo, useState } from "react";
import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import type { Branch } from "@shared/types";
import { BranchContextMenu } from "./BranchContextMenu";
import { BranchCreateDialog } from "./BranchCreateDialog";
import { MergeRebaseDialog } from "./MergeRebaseDialog";
import {
  buildBranchTree,
  countBranches,
  matchesFilter,
  type BranchTreeNode,
} from "../../lib/branch-tree";

export function BranchList({ filter }: { filter: string }) {
  const branches = useActive("branches") ?? [];
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const [menu, setMenu] = useState<{ x: number; y: number; branch: Branch } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [mergeDialog, setMergeDialog] =
    useState<{ kind: "merge" | "rebase"; source: string } | null>(null);
  // Inverse-of-expanded: tracking collapse is simpler than remembering every
  // folder the user has expanded on big repos.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filterLC = filter.trim().toLowerCase();

  const { localTree, remoteTree, localCount, remoteCount } = useMemo(() => {
    const locals = branches.filter((b) => b.isLocal);
    const remotes = branches.filter((b) => b.isRemote);
    return {
      localTree: buildBranchTree(locals),
      remoteTree: buildBranchTree(remotes),
      localCount: locals.length,
      remoteCount: remotes.length,
    };
  }, [branches]);

  async function checkout(name: string) {
    try {
      await unwrap(window.gitApi.checkout(name));
      toast("success", `Switched to ${name}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="p-1">
      <div className="flex items-center justify-between px-2 py-1 text-xs uppercase tracking-wide text-neutral-500">
        <span>Local ({localCount})</span>
        <button
          onClick={() => setShowCreate(true)}
          className="text-indigo-400 hover:text-indigo-300"
        >
          + New
        </button>
      </div>
      <TreeRenderer
        node={localTree}
        depth={0}
        filterLC={filterLC}
        collapsed={collapsed}
        toggleFolder={toggleFolder}
        onCheckout={checkout}
        onContextMenu={(e, branch) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, branch });
        }}
      />

      <div className="mt-2 px-2 py-1 text-xs uppercase tracking-wide text-neutral-500">
        Remote ({remoteCount})
      </div>
      <TreeRenderer
        node={remoteTree}
        depth={0}
        filterLC={filterLC}
        collapsed={collapsed}
        toggleFolder={toggleFolder}
        onCheckout={checkout}
        onContextMenu={(e, branch) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, branch });
        }}
      />

      {menu && (
        <BranchContextMenu
          x={menu.x}
          y={menu.y}
          branch={menu.branch}
          onClose={() => setMenu(null)}
          onMerge={(src) => setMergeDialog({ kind: "merge", source: src })}
          onRebase={(src) => setMergeDialog({ kind: "rebase", source: src })}
        />
      )}
      {showCreate && <BranchCreateDialog onClose={() => setShowCreate(false)} />}
      {mergeDialog && (
        <MergeRebaseDialog
          kind={mergeDialog.kind}
          source={mergeDialog.source}
          onClose={() => setMergeDialog(null)}
        />
      )}
    </div>
  );
}

interface TreeRendererProps {
  node: BranchTreeNode;
  depth: number;
  filterLC: string;
  collapsed: Set<string>;
  toggleFolder: (path: string) => void;
  onCheckout: (name: string) => void;
  onContextMenu: (e: React.MouseEvent, branch: Branch) => void;
}

function TreeRenderer(props: TreeRendererProps) {
  const { node, depth, filterLC, collapsed, toggleFolder, onCheckout, onContextMenu } = props;

  return (
    <>
      {node.children.map((child) => {
        // Hide subtrees that don't match the filter at all.
        if (filterLC && !matchesFilter(child, filterLC)) return null;

        const hasChildren = child.children.length > 0;
        const hasBranch = child.branch !== null;

        // Folder row (with optional inline leaf if a branch shares the folder name).
        const folderPath = child.fullPath;
        // An active filter auto-expands matching folders so results aren't hidden.
        const userCollapsed = collapsed.has(folderPath);
        const isExpanded = !userCollapsed || (filterLC.length > 0 && matchesFilter(child, filterLC));

        if (hasChildren) {
          return (
            <div key={folderPath}>
              <FolderRow
                name={child.name}
                depth={depth}
                expanded={isExpanded}
                count={countBranches(child)}
                onToggle={() => toggleFolder(folderPath)}
              />
              {isExpanded && (
                <>
                  {hasBranch && child.branch && (
                    <BranchRow
                      branch={child.branch}
                      label={child.name}
                      depth={depth + 1}
                      onDoubleClick={() => onCheckout(child.branch!.name)}
                      onContextMenu={(e) => onContextMenu(e, child.branch!)}
                    />
                  )}
                  <TreeRenderer {...props} node={child} depth={depth + 1} />
                </>
              )}
            </div>
          );
        }

        // Pure leaf.
        if (hasBranch && child.branch) {
          // Skip leaves that don't match when a filter is active.
          if (filterLC && !child.branch.name.toLowerCase().includes(filterLC)) return null;
          return (
            <BranchRow
              key={child.fullPath}
              branch={child.branch}
              label={child.name}
              depth={depth}
              onDoubleClick={() => onCheckout(child.branch!.name)}
              onContextMenu={(e) => onContextMenu(e, child.branch!)}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function FolderRow({
  name,
  depth,
  expanded,
  count,
  onToggle,
}: {
  name: string;
  depth: number;
  expanded: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className="flex cursor-pointer items-center rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <span className="mr-1 w-3 text-center text-[10px] text-neutral-500">
        {expanded ? "▾" : "▸"}
      </span>
      <FolderIcon />
      <span className="ml-1.5 min-w-0 flex-1 truncate">{name}</span>
      <span className="ml-2 shrink-0 text-[10px] text-neutral-600">{count}</span>
    </div>
  );
}

function BranchRow({
  branch,
  label,
  depth,
  onDoubleClick,
  onContextMenu,
}: {
  branch: Branch;
  label: string;
  depth: number;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`group flex items-center justify-between rounded py-1 pr-2 text-sm hover:bg-neutral-800 ${
        branch.isHead ? "bg-neutral-800" : ""
      }`}
      style={{ paddingLeft: 8 + depth * 12 + 16 /* align with folder icon */ }}
      title={branch.fullName}
    >
      <div className="flex min-w-0 flex-1 items-center">
        {branch.isHead && <span className="mr-1.5 text-indigo-400">●</span>}
        <span className="truncate">{label}</span>
      </div>
      {(branch.ahead ?? 0) + (branch.behind ?? 0) > 0 && (
        <div className="ml-2 flex shrink-0 items-center gap-1 text-[10px] text-neutral-500">
          {branch.ahead ? <span className="text-emerald-400">↑{branch.ahead}</span> : null}
          {branch.behind ? <span className="text-amber-400">↓{branch.behind}</span> : null}
        </div>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 text-neutral-500"
      fill="currentColor"
      aria-hidden
    >
      <path d="M1.75 2A1.75 1.75 0 0 0 0 3.75v8.5C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0 0 16 12.25v-7A1.75 1.75 0 0 0 14.25 3.5H8.31a.75.75 0 0 1-.53-.22L6.56 2.06A1.75 1.75 0 0 0 5.32 1.5H1.75Z" />
    </svg>
  );
}
