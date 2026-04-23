import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { unwrap } from "../../lib/ipc";
import type { Branch } from "@shared/types";
import { BranchContextMenu } from "./BranchContextMenu";
import { BranchCreateDialog } from "./BranchCreateDialog";
import { MergeRebaseDialog } from "./MergeRebaseDialog";
import { Prompt } from "../ui/Prompt";
import { PRCreateDialog } from "../github/PRCreateDialog";
import { EditRemoteDialog } from "../remotes/EditRemoteDialog";
import { useConfirm } from "../ui/Confirm";
import { FolderIcon, FolderOpenIcon, PullIcon, RemoteIcon } from "../ui/Icons";
import { RemoteAvatar } from "../ui/Avatar";
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
  const remotes = useActive("remotes") ?? [];
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const collapsedMap = useSettings((s) => s.collapsedBranchFolders);
  const setCollapsedFolders = useSettings((s) => s.setCollapsedBranchFolders);
  const [menu, setMenu] = useState<{ x: number; y: number; branch: Branch } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    path: string;
    isRemoteRoot: boolean;
  } | null>(null);
  const [remoteUrlEdit, setRemoteUrlEdit] = useState<{
    name: string;
    fetchUrl: string;
    pushUrl: string;
  } | null>(null);
  const [mergeDialog, setMergeDialog] =
    useState<{ kind: "merge" | "rebase"; source: string } | null>(null);
  const [renaming, setRenaming] = useState<Branch | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [prHead, setPrHead] = useState<string | null>(null);
  const [createFromBase, setCreateFromBase] = useState<string | null>(null);

  // Persist collapse state per-kind so local & remote sections remember
  // independently. The key is just `local` or `remote`; we don't scope by
  // repo path since folder names (like `feature/`) reliably recur across
  // repos and users expect the same collapse pattern everywhere.
  const collapsed = useMemo(
    () => new Set(collapsedMap[kind] ?? []),
    [collapsedMap, kind],
  );

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
      collapseAll: () => setCollapsedFolders(kind, allFolderPaths),
      expandAll: () => setCollapsedFolders(kind, []),
    }),
    [allFolderPaths, kind, setCollapsedFolders],
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

  // Collect all branch leaves at or below a folder path. Used by the
  // folder context menu to apply Pull/Delete to every branch under the
  // directory the user right-clicked on.
  function branchesUnder(folderPath: string): Branch[] {
    const prefix = folderPath + "/";
    return branches.filter(
      (b) =>
        (kind === "local" ? b.isLocal : b.isRemote) &&
        (b.name === folderPath || b.name.startsWith(prefix)),
    );
  }

  async function pullFolder(folderPath: string) {
    const targets = branchesUnder(folderPath).filter((b) => b.isLocal && b.tracking);
    if (targets.length === 0) {
      toast("info", "No trackable branches in this folder");
      return;
    }
    const ok = await confirmDialog({
      title: "Pull all",
      message: `Pull ${targets.length} branch${targets.length === 1 ? "" : "es"} under ${folderPath}/?`,
      confirmLabel: "Pull all",
    });
    if (!ok) return;
    const errors: string[] = [];
    for (const b of targets) {
      try {
        await unwrap(window.gitApi.pullBranch(b.name));
      } catch (e) {
        errors.push(`${b.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await refreshAll();
    if (errors.length === 0) {
      toast("success", `Pulled ${targets.length} branches`);
    } else {
      toast("error", `Some pulls failed:\n${errors.join("\n")}`);
    }
  }

  async function deleteFolder(folderPath: string) {
    const targets = branchesUnder(folderPath).filter((b) => b.isLocal && !b.isHead);
    if (targets.length === 0) {
      toast("info", "No deletable branches in this folder");
      return;
    }
    const names = targets.map((t) => t.name).join("\n");
    const ok = await confirmDialog({
      title: "Delete all",
      message: `Force delete ${targets.length} branch${targets.length === 1 ? "" : "es"} under ${folderPath}/?\nThis can discard unmerged commits.\n\n${names}`,
      confirmLabel: "Delete all",
      danger: true,
    });
    if (!ok) return;
    const errors: string[] = [];
    for (const b of targets) {
      try {
        await unwrap(window.gitApi.branchDelete(b.name, true));
      } catch (e) {
        errors.push(`${b.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await refreshAll();
    if (errors.length === 0) {
      toast("success", `Deleted ${targets.length} branches`);
    } else {
      toast("error", `Some deletes failed:\n${errors.join("\n")}`);
    }
  }

  const toggleFolder = (path: string) => {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsedFolders(kind, [...next]);
  };

  // For remote lists the top-level folder is the remote name (origin,
  // upstream, …). We swap that folder's icon with the RemoteAvatar so the
  // tree reads as "🏠 origin > feature > login" instead of a generic
  // "📁 origin > 📁 feature > login" which says nothing about which host
  // the branch lives on.
  const remoteByName = useMemo(
    () => new Map(remotes.map((r) => [r.name, r])),
    [remotes],
  );

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
          kind={kind}
          remoteByName={remoteByName}
          onContextMenu={(e, branch) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, branch });
          }}
          onFolderContextMenu={(e, path, depth) => {
            e.preventDefault();
            // Remote root folders (depth 0 under the "Remote" section)
            // correspond to an actual remote entry — surface the Set URL
            // affordance there. Deeper folders in remote are just path
            // prefixes, so we don't show the menu for them.
            const isRemoteRoot = kind === "remote" && depth === 0;
            if (kind === "remote" && !isRemoteRoot) return;
            setFolderMenu({ x: e.clientX, y: e.clientY, path, isRemoteRoot });
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
          onCreateBranch={(base) => setCreateFromBase(base)}
        />
      )}
      {folderMenu && (
        <FolderContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          path={folderMenu.path}
          count={branchesUnder(folderMenu.path).length}
          isRemoteRoot={folderMenu.isRemoteRoot}
          onClose={() => setFolderMenu(null)}
          onPullAll={() => {
            const p = folderMenu.path;
            setFolderMenu(null);
            void pullFolder(p);
          }}
          onDeleteAll={() => {
            const p = folderMenu.path;
            setFolderMenu(null);
            void deleteFolder(p);
          }}
          onSetRemoteUrl={() => {
            const name = folderMenu.path;
            setFolderMenu(null);
            const existing = remotes.find((r) => r.name === name);
            if (!existing) {
              toast("error", `Unknown remote ${name}`);
              return;
            }
            setRemoteUrlEdit({
              name,
              fetchUrl: existing.fetchUrl,
              pushUrl: existing.pushUrl,
            });
          }}
          onFetchRemote={async () => {
            const name = folderMenu.path;
            setFolderMenu(null);
            try {
              await unwrap(
                window.gitApi.fetch({ remote: name, all: false, prune: true }),
              );
              toast("success", `Fetched ${name}`);
              await refreshAll();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
      {remoteUrlEdit && (
        <EditRemoteDialog
          name={remoteUrlEdit.name}
          initialFetchUrl={remoteUrlEdit.fetchUrl}
          initialPushUrl={remoteUrlEdit.pushUrl}
          onClose={() => setRemoteUrlEdit(null)}
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
      {createFromBase && (
        <BranchCreateDialog
          initialBase={createFromBase}
          onClose={() => setCreateFromBase(null)}
        />
      )}
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
  kind: Kind;
  remoteByName: Map<string, import("@shared/types").Remote>;
  onContextMenu: (e: React.MouseEvent, branch: Branch) => void;
  onFolderContextMenu: (e: React.MouseEvent, path: string, depth: number) => void;
}

function TreeRenderer(props: TreeRendererProps) {
  const {
    node,
    depth,
    filterLC,
    collapsed,
    toggleFolder,
    onCheckout,
    onPull,
    pulling,
    kind,
    remoteByName,
    onContextMenu,
    onFolderContextMenu,
  } = props;

  return (
    <>
      {node.children.map((child) => {
        if (filterLC && !matchesFilter(child, filterLC)) return null;

        const hasChildren = child.children.length > 0;
        const hasBranch = child.branch !== null;
        const folderPath = child.fullPath;
        const isExpanded = !collapsed.has(folderPath);
        // Top-level folders in the Remote section are remote names (origin,
        // upstream, …) — render them with the host avatar rather than a
        // generic folder icon so the tree reads without the "remotes/x/"
        // prefix noise.
        const isRemoteRoot = kind === "remote" && depth === 0 && hasChildren;
        const remote = isRemoteRoot ? remoteByName.get(child.name) : undefined;

        if (hasChildren) {
          return (
            <div key={folderPath}>
              <FolderRow
                name={child.name}
                depth={depth}
                expanded={isExpanded}
                count={countBranches(child)}
                onToggle={() => toggleFolder(folderPath)}
                onContextMenu={(e) => onFolderContextMenu(e, folderPath, depth)}
                remoteUrl={remote?.fetchUrl}
                isRemoteRoot={isRemoteRoot}
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
  onContextMenu,
  remoteUrl,
  isRemoteRoot,
}: {
  name: string;
  depth: number;
  expanded: boolean;
  count: number;
  onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  remoteUrl?: string;
  isRemoteRoot?: boolean;
}) {
  return (
    <div
      onClick={onToggle}
      onContextMenu={onContextMenu}
      className="flex cursor-pointer items-center rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      style={{ paddingLeft: 8 + depth * 12 }}
      title={name}
    >
      <span className="mr-1 w-3 text-center text-[10px] text-neutral-500">
        {expanded ? "▾" : "▸"}
      </span>
      {isRemoteRoot ? (
        remoteUrl ? (
          <RemoteAvatar url={remoteUrl} size={14} />
        ) : (
          <RemoteIcon className="size-3.5 shrink-0 text-neutral-500" />
        )
      ) : expanded ? (
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
      className={`group flex cursor-pointer items-center justify-between rounded py-1 pr-2 text-sm hover:bg-neutral-800 ${
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

function FolderContextMenu({
  x,
  y,
  path,
  count,
  isRemoteRoot,
  onClose,
  onPullAll,
  onDeleteAll,
  onSetRemoteUrl,
  onFetchRemote,
}: {
  x: number;
  y: number;
  path: string;
  count: number;
  isRemoteRoot: boolean;
  onClose: () => void;
  onPullAll: () => void;
  onDeleteAll: () => void;
  onSetRemoteUrl: () => void;
  onFetchRemote: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        ref={ref}
        className="fixed z-30 min-w-[220px] rounded-md border border-neutral-800 bg-neutral-900 py-1 text-sm shadow-xl"
        style={{ left: x, top: y }}
      >
        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
          {path}/ ({count})
        </div>
        {isRemoteRoot ? (
          <>
            <button
              onClick={onFetchRemote}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              Fetch
            </button>
            <button
              onClick={onSetRemoteUrl}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              Set URLs…
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onPullAll}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              Pull all
            </button>
            <button
              onClick={onDeleteAll}
              className="block w-full px-3 py-1.5 text-left text-red-400 hover:bg-neutral-800"
            >
              Delete all…
            </button>
          </>
        )}
      </div>
    </>
  );
}
