import { useEffect, useMemo, useState } from "react";
import { useActive, useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { maybe, unwrap } from "../../lib/ipc";
import {
  CloseIcon,
  CommitIcon,
  FolderIcon,
  PathIcon,
  StashIcon,
  TreeIcon,
} from "../ui/Icons";
import { useConfirm } from "../ui/Confirm";
import type { FileDiff, FileStatus } from "@shared/types";

// Right-inspector view for a selected stash — mirrors the CommitDetail
// layout so stashes feel identical to commits: header, subject line,
// apply/pop/drop actions, and a file list the user clicks to open a
// diff in the main view. The per-file diff itself is rendered by
// StashFileDiff using the shared DiffView components.
export function StashDetail({ index }: { index: number }) {
  const stashes = useActive("stashes") ?? [];
  const stash = stashes.find((s) => s.index === index);
  const selectStash = useUI((s) => s.selectStash);
  const selectStashFile = useUI((s) => s.selectStashFile);
  const selectedStashFile = useUI((s) => s.selectedStashFile);
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const view = useSettings((s) => s.fileListViewMode);
  const setView = useSettings((s) => s.setFileListViewMode);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!stash) {
      setFiles(null);
      return;
    }
    // Keep the previous stash's file list on screen until the new one
    // arrives — eagerly resetting to null caused a "Loading…" flash
    // every time the user clicked a different stash. A cancelled
    // flag keeps an older in-flight response from overwriting a
    // newer stash's data if the user clicks quickly.
    let cancelled = false;
    void (async () => {
      const res = await maybe(window.gitApi.stashShowFiles(index));
      if (cancelled) return;
      const list = res ?? [];
      setFiles(list);
      // Auto-select the first file whenever the current selection
      // doesn't point inside this stash — covers both the initial
      // land (no selection) and the switch-between-stashes case
      // (selection left over from the previous stash). Same-stash
      // file clicks keep the user's manual pick because the index
      // matches and we fall through without touching it.
      const selectionInStash =
        selectedStashFile != null && selectedStashFile.index === index;
      if (list.length > 0 && !selectionInStash) {
        selectStashFile({ index, path: list[0].path });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, stash]);

  const stats = useMemo(() => {
    if (!files) return { modified: 0, added: 0, deleted: 0 };
    let modified = 0;
    let added = 0;
    let deleted = 0;
    for (const f of files) {
      const status = guessStatus(f);
      if (status === "added") added += 1;
      else if (status === "deleted") deleted += 1;
      else modified += 1;
    }
    return { modified, added, deleted };
  }, [files]);

  if (!stash) {
    return (
      <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-925 p-3 text-sm text-neutral-500">
        Stash no longer exists.
      </aside>
    );
  }

  async function run(fn: () => Promise<unknown>, msg: string, close = false) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast("success", msg);
      await refreshAll();
      if (close) selectStash(null);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const subject = stash.message.replace(
    /^(?:WIP )?[Oo]n [^:]+:\s*(?:[0-9a-f]{7,}\s+)?/i,
    "",
  );

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-925">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <StashIcon className="size-3.5" />
          <span className="mono text-neutral-200">{stash.ref}</span>
        </div>
        <button
          onClick={() => selectStash(null)}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          title="Close"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-neutral-800 px-4 py-4">
          <div className="text-[15px] font-medium leading-snug text-neutral-100">
            {subject || stash.message}
          </div>
          {stash.branch && (
            <div className="mt-1 text-xs text-neutral-500">on {stash.branch}</div>
          )}
        </div>

        <div className="flex flex-wrap gap-1 border-b border-neutral-800 px-3 py-2 text-xs">
          <button
            disabled={busy}
            onClick={() =>
              run(() => unwrap(window.gitApi.stashApply(stash.index)), "Applied")
            }
            className="rounded bg-neutral-800 px-2 py-1 text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                if (stash.index === 0) {
                  await unwrap(window.gitApi.stashPop());
                } else {
                  await unwrap(window.gitApi.stashApply(stash.index));
                  await unwrap(window.gitApi.stashDrop(stash.index));
                }
                toast("success", "Popped");
                await refreshAll();
                selectStash(null);
              } catch (e) {
                toast("error", e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            className="rounded bg-indigo-500 px-2 py-1 text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            Pop
          </button>
          <div className="flex-1" />
          <button
            disabled={busy}
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Drop stash",
                message: `Drop ${stash.ref}?\nThis can't be undone.`,
                confirmLabel: "Drop",
                danger: true,
              });
              if (!ok) return;
              void run(
                () => unwrap(window.gitApi.stashDrop(stash.index)),
                "Dropped",
                true,
              );
            }}
            className="rounded px-2 py-1 text-red-400 hover:bg-neutral-800 disabled:opacity-50"
          >
            Drop
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-neutral-400">
            {stats.modified > 0 && (
              <span>
                <span className="text-amber-400">{stats.modified}</span> modified
              </span>
            )}
            {stats.added > 0 && (
              <span>
                <span className="text-emerald-400">+ {stats.added}</span> added
              </span>
            )}
            {stats.deleted > 0 && (
              <span>
                <span className="text-red-400">− {stats.deleted}</span> deleted
              </span>
            )}
            {files?.length === 0 && <span>No files</span>}
          </div>
          <div className="flex rounded border border-neutral-800 p-0.5">
            <ViewToggle
              active={view === "path"}
              onClick={() => setView("path")}
            >
              <PathIcon className="size-3" /> Path
            </ViewToggle>
            <ViewToggle
              active={view === "tree"}
              onClick={() => setView("tree")}
            >
              <TreeIcon className="size-3" /> Tree
            </ViewToggle>
          </div>
        </div>

        {files === null ? (
          <div className="px-3 py-6 text-center text-xs text-neutral-500">
            Loading…
          </div>
        ) : files.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-neutral-500">
            <CommitIcon className="mx-auto size-6 text-neutral-700" />
            <div className="mt-2">No files</div>
          </div>
        ) : view === "path" ? (
          <ul className="p-1 text-sm">
            {files.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                label={f.path}
                index={index}
                isActive={
                  selectedStashFile?.index === index &&
                  selectedStashFile.path === f.path
                }
                onSelect={() => selectStashFile({ index, path: f.path })}
              />
            ))}
          </ul>
        ) : (
          <TreeView
            files={files}
            index={index}
            selectedStashFile={selectedStashFile}
            onSelect={(path) => selectStashFile({ index, path })}
          />
        )}
      </div>
    </aside>
  );
}

function ViewToggle({
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
      className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
        active
          ? "bg-neutral-800 text-neutral-100"
          : "text-neutral-500 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

function FileRow({
  file,
  label,
  depth = 0,
  isActive,
  onSelect,
}: {
  file: FileDiff;
  label: string;
  depth?: number;
  index: number;
  isActive: boolean;
  onSelect: () => void;
}) {
  const status = guessStatus(file);
  return (
    <button
      onClick={onSelect}
      title={file.path}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${
        isActive ? "bg-indigo-500/15" : "hover:bg-neutral-800"
      }`}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <StatusBadge status={status} />
      <span className="min-w-0 flex-1 truncate text-neutral-200">{label}</span>
    </button>
  );
}

interface TreeNode {
  name: string;
  file?: FileDiff;
  children: Map<string, TreeNode>;
}

function buildFileTree(files: FileDiff[]): TreeNode {
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
  return root;
}

function TreeView({
  files,
  index,
  selectedStashFile,
  onSelect,
}: {
  files: FileDiff[];
  index: number;
  selectedStashFile: { index: number; path: string } | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  return (
    <div className="text-sm">
      {[...tree.children.values()].map((n) => (
        <TreeNodeRow
          key={n.name}
          node={n}
          depth={0}
          index={index}
          selectedStashFile={selectedStashFile}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  index,
  selectedStashFile,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  index: number;
  selectedStashFile: { index: number; path: string } | null;
  onSelect: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isFile = !!node.file;
  if (isFile && node.children.size === 0) {
    const f = node.file!;
    return (
      <FileRow
        file={f}
        label={node.name}
        depth={depth}
        index={index}
        isActive={
          selectedStashFile?.index === index && selectedStashFile.path === f.path
        }
        onSelect={() => onSelect(f.path)}
      />
    );
  }
  return (
    <>
      <div
        onClick={() => setCollapsed((c) => !c)}
        className="flex cursor-pointer items-center gap-1.5 rounded py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </div>
      {!collapsed &&
        [...node.children.values()].map((c) => (
          <TreeNodeRow
            key={c.name}
            node={c}
            depth={depth + 1}
            index={index}
            selectedStashFile={selectedStashFile}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

// FileDiff doesn't carry an explicit status field — infer it from the
// hunk lines so the status badge matches the commit-file list.
function guessStatus(f: FileDiff): FileStatus {
  let hasAdd = false;
  let hasDel = false;
  for (const h of f.hunks) {
    for (const l of h.lines) {
      if (l.type === "add") hasAdd = true;
      else if (l.type === "del") hasDel = true;
      if (hasAdd && hasDel) break;
    }
  }
  if (hasAdd && !hasDel) return "added";
  if (hasDel && !hasAdd) return "deleted";
  return "modified";
}

function StatusBadge({ status }: { status: FileStatus }) {
  const map: Record<FileStatus, { letter: string; color: string }> = {
    added: { letter: "A", color: "bg-emerald-500/20 text-emerald-300" },
    modified: { letter: "M", color: "bg-amber-500/20 text-amber-300" },
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
