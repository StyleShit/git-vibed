import { useMemo, useState } from "react";
import { useActive, useRepo, useActiveTabShallow } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { CommitPanel } from "../commit/CommitPanel";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  PathIcon,
  TreeIcon,
  WorktreeIcon,
} from "../ui/Icons";
import type { FileChange, Worktree } from "@shared/types";

type ViewMode = "path" | "tree";

// Right-inspector "Changes" panel — combines staging + commit UI. Replaces
// the old separate ChangesView so there's a single place to stage and
// commit. Clicking a file sets selectedWipFile so the main area can swap
// to a diff viewer.
export function ChangesPanel() {
  const { status, worktrees, repoPath } = useActiveTabShallow((t) => ({
    status: t?.status ?? null,
    worktrees: t?.worktrees ?? [],
    repoPath: t?.path ?? "",
  }));
  const refreshStatus = useRepo((s) => s.refreshStatus);
  const toast = useUI((s) => s.toast);
  const selectWipFile = useUI((s) => s.selectWipFile);
  const selectedWipFile = useUI((s) => s.selectedWipFile);
  const [viewMode, setViewMode] = useState<ViewMode>("path");

  // Strip out any status entry whose path sits inside a known linked
  // worktree — those aren't "uncommitted changes", they're separate
  // working trees git happens to see as untracked.
  const { staged, unstaged } = useMemo(() => {
    if (!status) return { staged: [], unstaged: [] };
    const wtRels = worktreesRelativeToRepo(worktrees, repoPath);
    const notWorktree = (f: FileChange) => !isWorktreePath(f.path, wtRels);
    const mergedUnstaged = [...status.unstaged, ...status.conflicted].filter(notWorktree);
    const mergedStaged = status.staged.filter(notWorktree);
    return { staged: mergedStaged, unstaged: mergedUnstaged };
  }, [status, worktrees, repoPath]);

  const worktreeFiles = useMemo(() => {
    if (!status) return [];
    const wtRels = worktreesRelativeToRepo(worktrees, repoPath);
    const all = [...status.unstaged, ...status.conflicted, ...status.staged];
    const hits = all.filter((f) => isWorktreePath(f.path, wtRels));
    // De-dup by path; we don't care about staged/unstaged distinctions for
    // worktree entries since they shouldn't be committed to this repo anyway.
    return [...new Map(hits.map((f) => [f.path, f])).values()];
  }, [status, worktrees, repoPath]);

  const totalChanges = staged.length + unstaged.length;

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  const stage = (files: string[]) => run(() => unwrap(window.gitApi.stage(files)));
  const unstage = (files: string[]) => run(() => unwrap(window.gitApi.unstage(files)));
  const discard = (files: string[]) => {
    if (!confirm(`Discard changes to ${files.length} file${files.length === 1 ? "" : "s"}?`))
      return;
    return run(() => unwrap(window.gitApi.discard(files)));
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-925">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs">
        <span className="uppercase tracking-wider text-neutral-500">
          Uncommitted Changes
        </span>
        <div className="flex items-center gap-2">
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300">
            {totalChanges}
          </span>
          <div className="flex rounded border border-neutral-800 p-0.5">
            <ModeToggle active={viewMode === "path"} onClick={() => setViewMode("path")}>
              <PathIcon className="size-3" />
            </ModeToggle>
            <ModeToggle active={viewMode === "tree"} onClick={() => setViewMode("tree")}>
              <TreeIcon className="size-3" />
            </ModeToggle>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section
          title="Staged"
          count={staged.length}
          files={staged}
          staged
          viewMode={viewMode}
          selectedWipFile={selectedWipFile}
          onSelect={(p) => selectWipFile({ path: p, staged: true })}
          onAll={staged.length > 0 ? () => unstage(staged.map((f) => f.path)) : undefined}
          allLabel="Unstage all"
          onFile={(f) => unstage([f.path])}
          fileLabel="Unstage"
          emptyLabel="No staged files"
        />
        <Section
          title="Changes"
          count={unstaged.length}
          files={unstaged}
          staged={false}
          viewMode={viewMode}
          selectedWipFile={selectedWipFile}
          onSelect={(p) => selectWipFile({ path: p, staged: false })}
          onAll={unstaged.length > 0 ? () => stage(unstaged.map((f) => f.path)) : undefined}
          allLabel="Stage all"
          onFile={(f) => stage([f.path])}
          fileLabel="Stage"
          onExtra={(f) => discard([f.path])}
          extraLabel="Discard"
          emptyLabel="Working tree clean"
        />
        {worktreeFiles.length > 0 && <WorktreeNotice files={worktreeFiles} />}
      </div>
      <CommitPanel />
    </aside>
  );
}

function ModeToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 ${
        active ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  count,
  files,
  staged,
  viewMode,
  selectedWipFile,
  onSelect,
  onAll,
  allLabel,
  onFile,
  fileLabel,
  onExtra,
  extraLabel,
  emptyLabel,
}: {
  title: string;
  count: number;
  files: FileChange[];
  staged: boolean;
  viewMode: ViewMode;
  selectedWipFile: { path: string; staged: boolean } | null;
  onSelect: (path: string) => void;
  onAll?: () => void;
  allLabel: string;
  onFile: (f: FileChange) => void;
  fileLabel: string;
  onExtra?: (f: FileChange) => void;
  extraLabel?: string;
  emptyLabel: string;
}) {
  return (
    <div className="border-b border-neutral-800 last:border-b-0">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-neutral-925 px-3 py-1.5 text-[11px] uppercase tracking-wider text-neutral-400">
        <span>
          {title} ({count})
        </span>
        {onAll && (
          <button
            onClick={onAll}
            className="rounded px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-indigo-400 hover:bg-neutral-800 hover:text-indigo-300"
          >
            {allLabel}
          </button>
        )}
      </div>
      {files.length === 0 ? (
        <div className="px-3 py-3 text-xs text-neutral-500">{emptyLabel}</div>
      ) : viewMode === "path" ? (
        <div className="py-0.5">
          {files.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              label={f.path}
              selected={
                selectedWipFile?.path === f.path && selectedWipFile.staged === staged
              }
              onSelect={() => onSelect(f.path)}
              onAction={() => onFile(f)}
              actionLabel={fileLabel}
              onExtra={onExtra ? () => onExtra(f) : undefined}
              extraLabel={extraLabel}
            />
          ))}
        </div>
      ) : (
        <TreeView
          files={files}
          staged={staged}
          selectedWipFile={selectedWipFile}
          onSelect={onSelect}
          onAction={onFile}
          actionLabel={fileLabel}
          onExtra={onExtra}
          extraLabel={extraLabel}
        />
      )}
    </div>
  );
}

function FileRow({
  file,
  label,
  depth = 0,
  selected,
  onSelect,
  onAction,
  actionLabel,
  onExtra,
  extraLabel,
}: {
  file: FileChange;
  label: string;
  depth?: number;
  selected: boolean;
  onSelect: () => void;
  onAction: () => void;
  actionLabel: string;
  onExtra?: () => void;
  extraLabel?: string;
}) {
  return (
    <div
      onClick={onSelect}
      title={file.path}
      className={`group relative flex cursor-pointer items-center gap-2 py-1 pr-2 text-sm ${
        selected ? "bg-indigo-500/15" : "hover:bg-neutral-800"
      }`}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <StatusBadge status={file.status} />
      <span className="min-w-0 flex-1 truncate text-neutral-200">{label}</span>
      <div
        className="absolute inset-y-0.5 right-1 hidden items-center gap-0.5 rounded bg-neutral-800/95 px-1 shadow-lg backdrop-blur-sm group-hover:flex"
        onClick={(e) => e.stopPropagation()}
      >
        {onExtra && extraLabel && (
          <button
            onClick={onExtra}
            className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
          >
            {extraLabel}
          </button>
        )}
        <button
          onClick={onAction}
          className="rounded bg-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-100 hover:bg-neutral-600"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

interface TreeNode {
  name: string;
  file?: FileChange;
  children: Map<string, TreeNode>;
}

function buildTree(files: FileChange[]): TreeNode {
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
  // Collapse single-child folders so `a/b/c.ts` renders as `a/b/c.ts`
  // rather than three nested rows — matches VSCode's compact folders.
  return collapseChains(root);
}

function collapseChains(node: TreeNode): TreeNode {
  const kids = [...node.children.values()];
  for (const child of kids) {
    collapseChains(child);
    // Only collapse pure folders (no file) with exactly one child that is
    // itself a folder.
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

function TreeView({
  files,
  staged,
  selectedWipFile,
  onSelect,
  onAction,
  actionLabel,
  onExtra,
  extraLabel,
}: {
  files: FileChange[];
  staged: boolean;
  selectedWipFile: { path: string; staged: boolean } | null;
  onSelect: (path: string) => void;
  onAction: (f: FileChange) => void;
  actionLabel: string;
  onExtra?: (f: FileChange) => void;
  extraLabel?: string;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <div className="py-0.5 text-sm">
      {[...tree.children.values()].map((n) => (
        <TreeNodeRow
          key={n.name}
          node={n}
          depth={0}
          staged={staged}
          selectedWipFile={selectedWipFile}
          onSelect={onSelect}
          onAction={onAction}
          actionLabel={actionLabel}
          onExtra={onExtra}
          extraLabel={extraLabel}
        />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  staged,
  selectedWipFile,
  onSelect,
  onAction,
  actionLabel,
  onExtra,
  extraLabel,
}: {
  node: TreeNode;
  depth: number;
  staged: boolean;
  selectedWipFile: { path: string; staged: boolean } | null;
  onSelect: (path: string) => void;
  onAction: (f: FileChange) => void;
  actionLabel: string;
  onExtra?: (f: FileChange) => void;
  extraLabel?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (node.file && node.children.size === 0) {
    return (
      <FileRow
        file={node.file}
        label={node.name}
        depth={depth}
        selected={
          selectedWipFile?.path === node.file.path && selectedWipFile.staged === staged
        }
        onSelect={() => onSelect(node.file!.path)}
        onAction={() => onAction(node.file!)}
        actionLabel={actionLabel}
        onExtra={onExtra ? () => onExtra(node.file!) : undefined}
        extraLabel={extraLabel}
      />
    );
  }
  return (
    <>
      <div
        onClick={() => setCollapsed((c) => !c)}
        className="flex cursor-pointer items-center gap-1 rounded py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3 shrink-0 text-neutral-500" />
        ) : (
          <ChevronDownIcon className="size-3 shrink-0 text-neutral-500" />
        )}
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </div>
      {!collapsed &&
        [...node.children.values()].map((c) => (
          <TreeNodeRow
            key={c.name}
            node={c}
            depth={depth + 1}
            staged={staged}
            selectedWipFile={selectedWipFile}
            onSelect={onSelect}
            onAction={onAction}
            actionLabel={actionLabel}
            onExtra={onExtra}
            extraLabel={extraLabel}
          />
        ))}
    </>
  );
}

function WorktreeNotice({ files }: { files: FileChange[] }) {
  // Linked worktrees live inside the repo on disk so git sees them as
  // untracked. Surface them here so the user knows why they don't appear
  // in "Changes" — but don't let them be staged.
  return (
    <div className="border-t border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">
      <div className="mb-1 flex items-center gap-1.5">
        <WorktreeIcon className="size-3.5 text-neutral-500" />
        <span className="text-neutral-300">Linked worktrees</span>
      </div>
      <ul className="space-y-0.5 text-[11px] text-neutral-500">
        {files.map((f) => (
          <li key={f.path} className="truncate" title={f.path}>
            {f.path}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: FileChange["status"] }) {
  const map: Record<FileChange["status"], { letter: string; color: string }> = {
    modified: { letter: "M", color: "bg-amber-500/20 text-amber-300" },
    added: { letter: "A", color: "bg-emerald-500/20 text-emerald-300" },
    deleted: { letter: "D", color: "bg-red-500/20 text-red-300" },
    renamed: { letter: "R", color: "bg-blue-500/20 text-blue-300" },
    untracked: { letter: "?", color: "bg-neutral-700 text-neutral-300" },
    conflicted: { letter: "!", color: "bg-red-500/30 text-red-300" },
    typechange: { letter: "T", color: "bg-violet-500/20 text-violet-300" },
    ignored: { letter: "I", color: "bg-neutral-700 text-neutral-400" },
  };
  const s = map[status];
  return (
    <span
      className={`mono flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${s.color}`}
      title={status}
    >
      {s.letter}
    </span>
  );
}

// Worktree paths are stored absolute; convert to repo-relative so we can
// compare against the relative paths `git status` emits.
function worktreesRelativeToRepo(worktrees: Worktree[], repoPath: string): string[] {
  if (!repoPath) return [];
  const norm = repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const rels: string[] = [];
  for (const w of worktrees) {
    if (w.isMain) continue;
    const wp = w.path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (wp.startsWith(norm + "/")) {
      rels.push(wp.slice(norm.length + 1));
    }
  }
  return rels;
}

function isWorktreePath(filePath: string, worktreeRels: string[]): boolean {
  for (const rel of worktreeRels) {
    if (filePath === rel || filePath.startsWith(rel + "/")) return true;
  }
  return false;
}
