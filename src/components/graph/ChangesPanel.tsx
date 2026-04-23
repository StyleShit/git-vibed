import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@base-ui-components/react/menu";
import { useQuery } from "@tanstack/react-query";
import { buildTree, type TreeNode } from "../../lib/file-tree";
import { useRepo, useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { unwrap } from "../../lib/ipc";
import {
  gitStatusOptions,
  gitWorktreesOptions,
} from "../../queries/gitApi";
import { useConfirm } from "../ui/Confirm";
import { CommitPanel } from "../commit/CommitPanel";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  PathIcon,
  TreeIcon,
} from "../ui/Icons";
import type { FileChange, Worktree } from "@shared/types";

type ViewMode = "path" | "tree";

// Right-inspector "Changes" panel — combines staging + commit UI. Replaces
// the old separate ChangesView so there's a single place to stage and
// commit. Clicking a file sets selectedWipFile so the main area can swap
// to a diff viewer. Supports multi-select with ctrl/cmd/shift modifiers
// and a right-click context menu (Stage/Unstage/Stash/Discard).
export function ChangesPanel() {
  const activeTab = useActiveTab();
  const repoPath = activeTab?.path ?? "";
  const status = useQuery(gitStatusOptions(activeTab?.path)).data ?? null;
  const worktrees = useQuery(gitWorktreesOptions(activeTab?.path)).data ?? [];
  const refreshStatus = useRepo((s) => s.refreshStatus);
  const refreshStashes = useRepo((s) => s.refreshStashes);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const selectWipFile = useUI((s) => s.selectWipFile);
  const selectedWipFile = useUI((s) => s.selectedWipFile);
  const setView = useUI((s) => s.setView);
  const selectConflictFile = useUI((s) => s.selectConflictFile);
  const resolve = (path: string) => {
    selectConflictFile(path);
    setView("merge");
  };
  const viewMode = useSettings((s) => s.fileListViewMode);
  const setViewMode = useSettings((s) => s.setFileListViewMode);
  // Multi-selection lives on a per-section basis (staged vs unstaged) —
  // selecting "foo.ts" in Changes shouldn't carry over when you switch
  // focus to the Staged section. `section` keeps the two scopes apart.
  interface MultiSel {
    section: "staged" | "unstaged";
    paths: Set<string>;
    anchor: string | null;
  }
  const [multi, setMulti] = useState<MultiSel>({
    section: "unstaged",
    paths: new Set(),
    anchor: null,
  });
  const [menu, setMenu] = useState<
    | {
        x: number;
        y: number;
        section: "staged" | "unstaged";
        paths: string[];
      }
    | null
  >(null);

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

  const totalChanges = staged.length + unstaged.length;

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  // After staging / discarding files, re-focus the inspector on the last
  // remaining unstaged file so the user can keep reviewing without
  // manually clicking. Clears the inspector if nothing's left.
  function focusLastUnstagedAfter(removedPaths: Set<string>) {
    const remaining = unstaged.filter((f) => !removedPaths.has(f.path));
    if (remaining.length > 0) {
      const last = remaining[remaining.length - 1];
      selectWipFile({ path: last.path, staged: false });
    } else if (
      selectedWipFile &&
      !selectedWipFile.staged &&
      removedPaths.has(selectedWipFile.path)
    ) {
      selectWipFile(null);
    }
  }

  const clearMulti = () =>
    setMulti((m) => ({ section: m.section, paths: new Set(), anchor: null }));

  const stage = async (files: string[]) => {
    const set = new Set(files);
    await run(() => unwrap(window.gitApi.stage(files)));
    focusLastUnstagedAfter(set);
    clearMulti();
  };
  const unstage = async (files: string[]) => {
    await run(() => unwrap(window.gitApi.unstage(files)));
    clearMulti();
  };
  const discard = async (files: string[]) => {
    const ok = await confirmDialog({
      title: "Discard changes",
      message: `Discard changes to ${files.length} file${files.length === 1 ? "" : "s"}?\nThis can't be undone.`,
      confirmLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
    const set = new Set(files);
    await run(() => unwrap(window.gitApi.discard(files)));
    focusLastUnstagedAfter(set);
    clearMulti();
  };
  const discardAll = () => {
    if (unstaged.length === 0) return;
    void discard(unstaged.map((f) => f.path));
  };
  const stashFiles = async (files: string[]) => {
    if (files.length === 0) return;
    try {
      await unwrap(window.gitApi.stash({ files }));
      toast("success", `Stashed ${files.length} file${files.length === 1 ? "" : "s"}`);
      // If the file currently shown in the main diff viewer was stashed,
      // it's no longer in the working tree — close it so the user isn't
      // left staring at a stale diff.
      if (selectedWipFile && files.includes(selectedWipFile.path)) {
        selectWipFile(null);
      }
      await refreshStatus();
      await refreshStashes();
      clearMulti();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  // Click handler factory used by both path-mode and tree-mode rows so the
  // selection semantics are identical. Cmd/Ctrl toggles, Shift extends
  // from the anchor, plain click resets to a single selection.
  const handleClick = useCallback(
    (
      section: "staged" | "unstaged",
      path: string,
      e: React.MouseEvent,
    ) => {
      setMulti((prev) => {
        const sameSection = prev.section === section;
        const list = (section === "staged" ? staged : unstaged).map((f) => f.path);
        if (e.shiftKey && sameSection && prev.anchor) {
          const a = list.indexOf(prev.anchor);
          const b = list.indexOf(path);
          if (a === -1 || b === -1) return prev;
          const [from, to] = a < b ? [a, b] : [b, a];
          const paths = new Set(list.slice(from, to + 1));
          return { section, paths, anchor: prev.anchor };
        }
        if (e.metaKey || e.ctrlKey) {
          const paths = new Set(sameSection ? prev.paths : []);
          if (paths.has(path)) paths.delete(path);
          else paths.add(path);
          return { section, paths, anchor: path };
        }
        return { section, paths: new Set([path]), anchor: path };
      });
      selectWipFile({ path, staged: section === "staged" });
    },
    [staged, unstaged, selectWipFile],
  );

  const isSelected = (section: "staged" | "unstaged", path: string) =>
    multi.section === section && multi.paths.has(path);

  // Right-click: if the clicked path is in the current selection, operate
  // on the whole selection; otherwise replace selection with just the
  // clicked file so the menu always has a clear target set.
  const openContextMenu = (
    section: "staged" | "unstaged",
    path: string,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const inCurrent =
      multi.section === section && multi.paths.has(path) && multi.paths.size > 1;
    const paths = inCurrent ? [...multi.paths] : [path];
    if (!inCurrent) {
      setMulti({ section, paths: new Set([path]), anchor: path });
    }
    setMenu({ x: e.clientX, y: e.clientY, section, paths });
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-925">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-xs">
        <span
          className="min-w-0 flex-1 truncate uppercase tracking-wider text-neutral-500"
          title="Uncommitted changes"
        >
          Uncommitted changes
        </span>
        <div className="flex shrink-0 items-center gap-2">
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
          section="staged"
          viewMode={viewMode}
          selectedWipFile={selectedWipFile}
          isSelected={(p) => isSelected("staged", p)}
          onRowClick={handleClick}
          onContextMenu={openContextMenu}
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
          section="unstaged"
          viewMode={viewMode}
          selectedWipFile={selectedWipFile}
          isSelected={(p) => isSelected("unstaged", p)}
          onRowClick={handleClick}
          onContextMenu={openContextMenu}
          onAll={unstaged.length > 0 ? () => stage(unstaged.map((f) => f.path)) : undefined}
          allLabel="Stage all"
          onAllExtra={unstaged.length > 0 ? discardAll : undefined}
          allExtraLabel="Discard all"
          onFile={(f) => stage([f.path])}
          fileLabel="Stage"
          onExtra={(f) => discard([f.path])}
          extraLabel="Discard"
          onResolve={resolve}
          emptyLabel="Working tree clean"
        />
      </div>
      <CommitPanel />

      {menu && (
        <FileContextMenu
          x={menu.x}
          y={menu.y}
          section={menu.section}
          paths={menu.paths}
          onClose={() => setMenu(null)}
          onStage={() => stage(menu.paths)}
          onUnstage={() => unstage(menu.paths)}
          onStash={() => stashFiles(menu.paths)}
          onDiscard={() => discard(menu.paths)}
        />
      )}
    </aside>
  );
}

function FileContextMenu({
  x,
  y,
  section,
  paths,
  onClose,
  onStage,
  onUnstage,
  onStash,
  onDiscard,
}: {
  x: number;
  y: number;
  section: "staged" | "unstaged";
  paths: string[];
  onClose: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onStash: () => void;
  onDiscard: () => void;
}) {
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({ x, y, width: 0, height: 0 }),
    }),
    [x, y],
  );
  const n = paths.length;
  const plural = n === 1 ? "" : "s";
  const header = `${n} file${plural} selected`;
  return (
    <Menu.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      modal={false}
    >
      <Menu.Portal>
        <Menu.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={0}
          className="z-50 outline-none"
        >
          <Menu.Popup className="min-w-[220px] rounded-md border border-neutral-800 bg-neutral-900 py-1 text-sm shadow-xl outline-none">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500">
              {header}
            </div>
            {section === "unstaged" && <MenuItem onClick={onStage}>Stage</MenuItem>}
            {section === "staged" && <MenuItem onClick={onUnstage}>Unstage</MenuItem>}
            <MenuItem onClick={onStash}>Stash…</MenuItem>
            {section === "unstaged" && (
              <MenuItem onClick={onDiscard} danger>
                Discard changes…
              </MenuItem>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Menu.Item
      onClick={onClick}
      className={`block w-full cursor-default px-3 py-1.5 text-left outline-none data-[highlighted]:bg-neutral-800 ${
        danger ? "text-red-400" : "text-neutral-200"
      }`}
    >
      {children}
    </Menu.Item>
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
  section,
  viewMode,
  selectedWipFile,
  isSelected,
  onRowClick,
  onContextMenu,
  onAll,
  allLabel,
  onAllExtra,
  allExtraLabel,
  onFile,
  fileLabel,
  onExtra,
  extraLabel,
  onResolve,
  emptyLabel,
}: {
  title: string;
  count: number;
  files: FileChange[];
  section: "staged" | "unstaged";
  viewMode: ViewMode;
  selectedWipFile: { path: string; staged: boolean } | null;
  isSelected: (path: string) => boolean;
  onRowClick: (
    section: "staged" | "unstaged",
    path: string,
    e: React.MouseEvent,
  ) => void;
  onContextMenu: (
    section: "staged" | "unstaged",
    path: string,
    e: React.MouseEvent,
  ) => void;
  onAll?: () => void;
  allLabel: string;
  onAllExtra?: () => void;
  allExtraLabel?: string;
  onFile: (f: FileChange) => void;
  fileLabel: string;
  onExtra?: (f: FileChange) => void;
  extraLabel?: string;
  onResolve?: (path: string) => void;
  emptyLabel: string;
}) {
  const staged = section === "staged";
  return (
    <div className="border-b border-neutral-800 last:border-b-0">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-neutral-925 px-3 py-1.5 text-[11px] uppercase tracking-wider text-neutral-400">
        <span>
          {title} ({count})
        </span>
        <div className="flex items-center gap-1">
          {onAllExtra && allExtraLabel && (
            <button
              onClick={onAllExtra}
              className="rounded px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-red-400 hover:bg-neutral-800 hover:text-red-300"
            >
              {allExtraLabel}
            </button>
          )}
          {onAll && (
            <button
              onClick={onAll}
              className="rounded px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-indigo-400 hover:bg-neutral-800 hover:text-indigo-300"
            >
              {allLabel}
            </button>
          )}
        </div>
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
              active={
                selectedWipFile?.path === f.path && selectedWipFile.staged === staged
              }
              highlighted={isSelected(f.path)}
              onClick={(e) => onRowClick(section, f.path, e)}
              onContextMenu={(e) => onContextMenu(section, f.path, e)}
              onAction={() => onFile(f)}
              actionLabel={fileLabel}
              onExtra={onExtra ? () => onExtra(f) : undefined}
              extraLabel={extraLabel}
              onResolve={
                onResolve && f.status === "conflicted" ? () => onResolve(f.path) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <TreeView
          files={files}
          section={section}
          selectedWipFile={selectedWipFile}
          isSelected={isSelected}
          onRowClick={onRowClick}
          onContextMenu={onContextMenu}
          onAction={onFile}
          actionLabel={fileLabel}
          onExtra={onExtra}
          extraLabel={extraLabel}
          onResolve={onResolve}
        />
      )}
    </div>
  );
}

function FileRow({
  file,
  label,
  depth = 0,
  active,
  highlighted,
  onClick,
  onContextMenu,
  onAction,
  actionLabel,
  onExtra,
  extraLabel,
  onResolve,
}: {
  file: FileChange;
  label: string;
  depth?: number;
  // `active` = currently shown in the main-area diff viewer.
  // `highlighted` = part of the multi-selection for bulk actions.
  active: boolean;
  highlighted: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onAction: () => void;
  actionLabel: string;
  onExtra?: () => void;
  extraLabel?: string;
  onResolve?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={file.path}
      className={`group relative flex cursor-pointer items-center gap-2 py-1 pr-2 text-sm ${
        active
          ? "bg-indigo-500/15"
          : highlighted
            ? "bg-indigo-500/10"
            : "hover:bg-neutral-800"
      }`}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <StatusBadge status={file.status} />
      <span className="min-w-0 flex-1 truncate text-neutral-200">{label}</span>
      <div
        className="absolute inset-y-0.5 right-1 hidden items-center gap-0.5 rounded bg-neutral-800/95 px-1 shadow-lg backdrop-blur-sm group-hover:flex"
        onClick={(e) => e.stopPropagation()}
      >
        {onResolve && (
          <button
            onClick={onResolve}
            className="rounded bg-fuchsia-500/25 px-1.5 py-0.5 text-[11px] text-fuchsia-100 hover:bg-fuchsia-500/40"
          >
            Resolve
          </button>
        )}
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

function TreeView({
  files,
  section,
  selectedWipFile,
  isSelected,
  onRowClick,
  onContextMenu,
  onAction,
  actionLabel,
  onExtra,
  extraLabel,
  onResolve,
}: {
  files: FileChange[];
  section: "staged" | "unstaged";
  selectedWipFile: { path: string; staged: boolean } | null;
  isSelected: (path: string) => boolean;
  onRowClick: (
    section: "staged" | "unstaged",
    path: string,
    e: React.MouseEvent,
  ) => void;
  onContextMenu: (
    section: "staged" | "unstaged",
    path: string,
    e: React.MouseEvent,
  ) => void;
  onAction: (f: FileChange) => void;
  actionLabel: string;
  onExtra?: (f: FileChange) => void;
  extraLabel?: string;
  onResolve?: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <div className="py-0.5 text-sm">
      {[...tree.children.values()].map((n) => (
        <TreeNodeRow
          key={n.name}
          node={n}
          depth={0}
          section={section}
          selectedWipFile={selectedWipFile}
          isSelected={isSelected}
          onRowClick={onRowClick}
          onContextMenu={onContextMenu}
          onAction={onAction}
          actionLabel={actionLabel}
          onExtra={onExtra}
          extraLabel={extraLabel}
          onResolve={onResolve}
        />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  section,
  selectedWipFile,
  isSelected,
  onRowClick,
  onContextMenu,
  onAction,
  actionLabel,
  onExtra,
  extraLabel,
  onResolve,
}: {
  node: TreeNode;
  depth: number;
  section: "staged" | "unstaged";
  selectedWipFile: { path: string; staged: boolean } | null;
  isSelected: (path: string) => boolean;
  onRowClick: (
    section: "staged" | "unstaged",
    path: string,
    e: React.MouseEvent,
  ) => void;
  onContextMenu: (
    section: "staged" | "unstaged",
    path: string,
    e: React.MouseEvent,
  ) => void;
  onAction: (f: FileChange) => void;
  actionLabel: string;
  onExtra?: (f: FileChange) => void;
  extraLabel?: string;
  onResolve?: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const staged = section === "staged";

  if (node.file && node.children.size === 0) {
    const f = node.file;
    return (
      <FileRow
        file={f}
        label={node.name}
        depth={depth}
        active={selectedWipFile?.path === f.path && selectedWipFile.staged === staged}
        highlighted={isSelected(f.path)}
        onClick={(e) => onRowClick(section, f.path, e)}
        onContextMenu={(e) => onContextMenu(section, f.path, e)}
        onAction={() => onAction(f)}
        actionLabel={actionLabel}
        onExtra={onExtra ? () => onExtra(f) : undefined}
        extraLabel={extraLabel}
        onResolve={
          onResolve && f.status === "conflicted" ? () => onResolve(f.path) : undefined
        }
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
            section={section}
            selectedWipFile={selectedWipFile}
            isSelected={isSelected}
            onRowClick={onRowClick}
            onContextMenu={onContextMenu}
            onAction={onAction}
            actionLabel={actionLabel}
            onExtra={onExtra}
            extraLabel={extraLabel}
            onResolve={onResolve}
          />
        ))}
    </>
  );
}

function StatusBadge({ status }: { status: FileChange["status"] }) {
  // Untracked files are effectively "new/added from git's perspective" —
  // render them with the same green "A" so the changes list reads as a
  // uniform set of additions rather than mixing an ambiguous "?" in.
  const map: Record<FileChange["status"], { letter: string; color: string }> = {
    modified: { letter: "M", color: "bg-amber-500/20 text-amber-300" },
    added: { letter: "A", color: "bg-emerald-500/20 text-emerald-300" },
    deleted: { letter: "D", color: "bg-red-500/20 text-red-300" },
    renamed: { letter: "R", color: "bg-blue-500/20 text-blue-300" },
    untracked: { letter: "A", color: "bg-emerald-500/20 text-emerald-300" },
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
