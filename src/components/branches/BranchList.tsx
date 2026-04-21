import { useMemo, useState } from "react";
import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import type { Branch } from "@shared/types";
import { BranchContextMenu } from "./BranchContextMenu";
import { BranchCreateDialog } from "./BranchCreateDialog";
import { MergeRebaseDialog } from "./MergeRebaseDialog";
import { Prompt } from "../ui/Prompt";
import { PRCreateDialog } from "../github/PRCreateDialog";
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
  const [renaming, setRenaming] = useState<Branch | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [prHead, setPrHead] = useState<string | null>(null);
  // Inverse-of-expanded: tracking collapse is simpler than remembering every
  // folder the user has expanded on big repos. This state is respected even
  // when a filter is active, so the user can always collapse a folder.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filterLC = filter.trim().toLowerCase();

  const { localTree, remoteTree, localCount, remoteCount, allFolderPaths } = useMemo(() => {
    const locals = branches.filter((b) => b.isLocal);
    const remotes = branches.filter((b) => b.isRemote);
    const lt = buildBranchTree(locals);
    const rt = buildBranchTree(remotes);
    const paths: string[] = [];
    collectFolderPaths(lt, paths);
    collectFolderPaths(rt, paths);
    return {
      localTree: lt,
      remoteTree: rt,
      localCount: locals.length,
      remoteCount: remotes.length,
      allFolderPaths: paths,
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

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allFolderPaths));

  return (
    <div className="p-1">
      <div className="flex items-center gap-1 px-2 py-1 text-xs">
        <button
          onClick={expandAll}
          className="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          title="Expand all folders"
        >
          ⤢
        </button>
        <button
          onClick={collapseAll}
          className="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          title="Collapse all folders"
        >
          ⤡
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate(true)}
          className="text-indigo-400 hover:text-indigo-300"
        >
          + New
        </button>
      </div>

      <SectionHeader label="Local" count={localCount} />
      <TreeRenderer
        node={localTree}
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

      <SectionHeader label="Remote" count={remoteCount} />
      <TreeRenderer
        node={remoteTree}
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
      {showCreate && <BranchCreateDialog onClose={() => setShowCreate(false)} />}
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
      {prHead && (
        <PRCreateDialog headBranch={prHead} onClose={() => setPrHead(null)} />
      )}
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="mt-1 px-2 py-1 text-xs uppercase tracking-wide text-neutral-500">
      {label} ({count})
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
  onPull: (name: string) => void;
  pulling: string | null;
  onContextMenu: (e: React.MouseEvent, branch: Branch) => void;
}

function TreeRenderer(props: TreeRendererProps) {
  const { node, depth, filterLC, collapsed, toggleFolder, onCheckout, onPull, pulling, onContextMenu } = props;

  return (
    <>
      {node.children.map((child) => {
        // Hide subtrees that don't match the filter at all.
        if (filterLC && !matchesFilter(child, filterLC)) return null;

        const hasChildren = child.children.length > 0;
        const hasBranch = child.branch !== null;
        const folderPath = child.fullPath;
        // Always respect user's explicit collapse — even during filter. User
        // can collapse a matching folder to hide clutter and still type filter.
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

        // Pure leaf.
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
  // Pull only makes sense for local branches that have an upstream; remote
  // tracking branches don't have one to pull from.
  const canPull = branch.isLocal && !!branch.tracking;
  const isPulling = pulling === branch.name;
  const behind = branch.behind ?? 0;
  const ahead = branch.ahead ?? 0;

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
            <PullIcon spin={isPulling} />
          </button>
        )}
      </div>
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

function PullIcon({ spin }: { spin: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 ${spin ? "animate-spin" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2v9m0 0-3-3m3 3 3-3M3 14h10" />
    </svg>
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
