import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import type { Branch } from "@shared/types";
import { BranchContextMenu } from "./BranchContextMenu";
import { MergeRebaseDialog } from "./MergeRebaseDialog";
import { Prompt } from "../ui/Prompt";
import { PRCreateDialog } from "../github/PRCreateDialog";
import { FolderIcon, FolderOpenIcon, PullIcon } from "../ui/Icons";
import {
  buildBranchTree,
  countBranches,
  matchesFilter,
  type BranchTreeNode,
} from "../../lib/branch-tree";

type Kind = "local" | "remote";

// Imperative methods exposed through a forwarded ref so the sidebar
// section header (which owns the "collapse all" / "expand all" buttons)
// can reach into the tree state without lifting it completely.
export interface BranchListHandle {
  collapseAll: () => void;
  expandAll: () => void;
}

interface Props {
  filter: string;
  kind?: Kind;
}

// Shared tree renderer — used by both LOCAL and REMOTE sidebar sections.
export const BranchList = forwardRef<BranchListHandle, Props>(function BranchList(
  { filter, kind = "local" },
  ref,
) {
  const branches = useActive("branches") ?? [];
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const [menu, setMenu] = useState<{ x: number; y: number; branch: Branch } | null>(null);
  const [mergeDialog, setMergeDialog] =
    useState<{ kind: "merge" | "rebase"; source: string } | null>(null);
  const [renaming, setRenaming] = useState<Branch | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [prHead, setPrHead] = useState<string | null>(null);
  // Inverse-of-expanded: tracking collapse is simpler than remembering every
  // folder the user has expanded on big repos. This state is respected even
  // when a filter is active, so the user can always collapse a folder.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filterLC = filter.trim().toLowerCase();

  const { tree, allFolderPaths, total } = useMemo(() => {
    const pool = branches.filter((b) => (kind === "local" ? b.isLocal : b.isRemote));
    const t = buildBranchTree(pool);
    const paths: string[] = [];
    collectFolderPaths(t, paths);
    return { tree: t, allFolderPaths: paths, total: pool.length };
  }, [branches, kind]);

  useImperativeHandle(
    ref,
    () => ({
      collapseAll: () => setCollapsed(new Set(allFolderPaths)),
      expandAll: () => setCollapsed(new Set()),
    }),
    [allFolderPaths],
  );

  async function checkout(name: string) {
    try {
      await unwrap(window.gitApi.checkout(name));
      toast("success", `Switched to ${name}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRename(newName: string) {
    const target = renaming;
    setRenaming(null);
    if (!target || newName === target.name) return;
    try {
      await unwrap(window.gitApi.branchRename(target.name, newName));
      toast("success", `Renamed to ${newName}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function pullBranch(name: string) {
    setPulling(name);
    try {
      await unwrap(window.gitApi.pullBranch(name));
      toast("success", `Pulled ${name}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(null);
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
    <div>
      {total === 0 ? (
        <div className="px-3 py-3 text-xs text-neutral-500">
          {kind === "remote"
            ? "No remotes configured. Add one with git remote add, then Fetch."
            : "No local branches yet."}
        </div>
      ) : (
        <TreeRenderer
          node={tree}
          depth={0}
          filterLC={filterLC}
          collapsed={collapsed}
          toggleFolder={toggleFolder}
          onCheckout={checkout}
          onPull={pullBranch}
          pulling={pulling}
          onContextMenu={(e, branch) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, branch });
          }}
        />
      )}

      {menu && (
        <BranchContextMenu
          x={menu.x}
          y={menu.y}
          branch={menu.branch}
          onClose={() => setMenu(null)}
          onMerge={(src) => setMergeDialog({ kind: "merge", source: src })}
          onRebase={(src) => setMergeDialog({ kind: "rebase", source: src })}
          onRename={(b) => setRenaming(b)}
          onOpenPR={(b) => setPrHead(b.name)}
        />
      )}
      {mergeDialog && (
        <MergeRebaseDialog
          kind={mergeDialog.kind}
          source={mergeDialog.source}
          onClose={() => setMergeDialog(null)}
        />
      )}
      {renaming && (
        <Prompt
          title="Rename Branch"
          label="New name"
          defaultValue={renaming.name}
          submitLabel="Rename"
          onSubmit={handleRename}
          onCancel={() => setRenaming(null)}
        />
      )}
      {prHead && <PRCreateDialog headBranch={prHead} onClose={() => setPrHead(null)} />}
    </div>
  );
});

interface TreeRendererProps {
  node: BranchTreeNode;
  depth: number;
  filterLC: string;
  collapsed: Set<string>;
  toggleFolder: (path: string) => void;
  onCheckout: (name: string) => void;
  onPull: (name: string) => void;
  pulling: string | null;
  onContextMenu: (e: React.MouseEvent, branch: Branch) => void;
}

function TreeRenderer(props: TreeRendererProps) {
  const { node, depth, filterLC, collapsed, toggleFolder, onCheckout, onPull, pulling, onContextMenu } =
    props;

  return (
    <>
      {node.children.map((child) => {
        if (filterLC && !matchesFilter(child, filterLC)) return null;

        const hasChildren = child.children.length > 0;
        const hasBranch = child.branch !== null;
        const folderPath = child.fullPath;
        const isExpanded = !collapsed.has(folderPath);

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
                      pulling={pulling}
                      onDoubleClick={() => onCheckout(child.branch!.name)}
                      onContextMenu={(e) => onContextMenu(e, child.branch!)}
                      onPull={() => onPull(child.branch!.name)}
                    />
                  )}
                  <TreeRenderer {...props} node={child} depth={depth + 1} />
                </>
              )}
            </div>
          );
        }

        if (hasBranch && child.branch) {
          if (filterLC && !child.branch.name.toLowerCase().includes(filterLC)) return null;
          return (
            <BranchRow
              key={child.fullPath}
              branch={child.branch}
              label={child.name}
              depth={depth}
              pulling={pulling}
              onDoubleClick={() => onCheckout(child.branch!.name)}
              onContextMenu={(e) => onContextMenu(e, child.branch!)}
              onPull={() => onPull(child.branch!.name)}
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
      {expanded ? (
        <FolderOpenIcon className="size-3.5 shrink-0 text-neutral-500" />
      ) : (
        <FolderIcon className="size-3.5 shrink-0 text-neutral-500" />
      )}
      <span className="ml-1.5 min-w-0 flex-1 truncate">{name}</span>
      <span className="ml-2 shrink-0 text-[10px] text-neutral-600">{count}</span>
    </div>
  );
}

function BranchRow({
  branch,
  label,
  depth,
  pulling,
  onDoubleClick,
  onContextMenu,
  onPull,
}: {
  branch: Branch;
  label: string;
  depth: number;
  pulling: string | null;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onPull?: () => void;
}) {
  const setHovered = useUI((s) => s.setHoveredBranch);
  const canPull = branch.isLocal && !!branch.tracking;
  const isPulling = pulling === branch.name;
  const behind = branch.behind ?? 0;
  const ahead = branch.ahead ?? 0;

  return (
    <div
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(branch.name)}
      onMouseLeave={() => setHovered(null)}
      className={`group flex items-center justify-between rounded py-1 pr-2 text-sm hover:bg-neutral-800 ${
        branch.isHead ? "bg-indigo-500/10" : ""
      }`}
      style={{ paddingLeft: 8 + depth * 12 + 16 }}
      title={branch.fullName}
    >
      <div className="flex min-w-0 flex-1 items-center">
        {branch.isHead && (
          <span className="mr-1.5 inline-block size-1.5 shrink-0 rounded-full bg-indigo-400" />
        )}
        <span
          className={`truncate ${branch.isHead ? "font-medium text-neutral-100" : "text-neutral-300"}`}
        >
          {label}
        </span>
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-1 text-[10px] text-neutral-500">
        {ahead > 0 && <span className="text-emerald-400">↑{ahead}</span>}
        {behind > 0 && <span className="text-amber-400">↓{behind}</span>}
        {canPull && onPull && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPull();
            }}
            disabled={isPulling}
            title={isPulling ? "Pulling…" : `Pull ${branch.name}`}
            className={`rounded p-0.5 hover:bg-neutral-700 hover:text-neutral-100 ${
              behind > 0 ? "text-amber-400 opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <PullIcon className={`size-3 ${isPulling ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>
    </div>
  );
}

// Walk the tree collecting every folder's full path — used to collapse all
// folders in one go without re-traversing on click.
function collectFolderPaths(node: BranchTreeNode, out: string[]) {
  for (const child of node.children) {
    if (child.children.length > 0) {
      out.push(child.fullPath);
      collectFolderPaths(child, out);
    }
  }
}
