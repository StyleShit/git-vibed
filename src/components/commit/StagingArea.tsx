import { useRepo } from "../../stores/repo";
import type { FileChange } from "@shared/types";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";

interface Props {
  selected: { path: string; staged: boolean } | null;
  onSelect: (s: { path: string; staged: boolean } | null) => void;
}

export function StagingArea({ selected, onSelect }: Props) {
  const { status, refreshStatus } = useRepo();
  const toast = useUI((s) => s.toast);
  if (!status) return null;
  const unstaged = [...status.unstaged, ...status.conflicted];

  async function stage(files: string[]) {
    try {
      await unwrap(window.gitApi.stage(files));
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function unstage(files: string[]) {
    try {
      await unwrap(window.gitApi.unstage(files));
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function discard(files: string[]) {
    if (!confirm(`Discard changes to ${files.length} file${files.length === 1 ? "" : "s"}?`)) return;
    try {
      await unwrap(window.gitApi.discard(files));
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Section
        title="Staged"
        files={status.staged}
        selected={selected}
        onSelect={(path) => onSelect({ path, staged: true })}
        actionLabel="Unstage"
        action={(files) => unstage(files.map((f) => f.path))}
        onAllClick={() => unstage(status.staged.map((f) => f.path))}
        allLabel="Unstage All"
        empty="No staged changes"
        staged
      />
      <Section
        title="Changes"
        files={unstaged}
        selected={selected}
        onSelect={(path) => onSelect({ path, staged: false })}
        actionLabel="Stage"
        action={(files) => stage(files.map((f) => f.path))}
        onAllClick={() => stage(unstaged.map((f) => f.path))}
        allLabel="Stage All"
        empty="Working tree clean"
        extraAction={(files) => discard(files.map((f) => f.path))}
        extraLabel="Discard"
        staged={false}
      />
    </div>
  );
}

function Section({
  title,
  files,
  selected,
  onSelect,
  actionLabel,
  action,
  extraAction,
  extraLabel,
  onAllClick,
  allLabel,
  empty,
  staged,
}: {
  title: string;
  files: FileChange[];
  selected: Props["selected"];
  onSelect: (path: string) => void;
  actionLabel: string;
  action: (files: FileChange[]) => void;
  extraAction?: (files: FileChange[]) => void;
  extraLabel?: string;
  onAllClick: () => void;
  allLabel: string;
  empty: string;
  staged: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-neutral-800">
      <div className="flex items-center justify-between px-3 py-2 text-xs uppercase tracking-wide text-neutral-400">
        <span>
          {title} ({files.length})
        </span>
        {files.length > 0 && (
          <button className="text-[11px] text-indigo-400 hover:text-indigo-300" onClick={onAllClick}>
            {allLabel}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 && (
          <div className="px-3 py-4 text-xs text-neutral-500">{empty}</div>
        )}
        {files.map((f) => {
          const isSelected =
            selected?.path === f.path && selected.staged === staged;
          return (
            <div
              key={f.path}
              className={`group flex cursor-pointer items-center px-3 py-1 text-sm ${
                isSelected ? "bg-neutral-800" : "hover:bg-neutral-900"
              }`}
              onClick={() => onSelect(f.path)}
            >
              <StatusBadge status={f.status} />
              <span className="ml-2 min-w-0 flex-1 truncate" title={f.path}>
                {f.path}
              </span>
              <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                {extraAction && (
                  <button
                    className="rounded px-1.5 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      extraAction([f]);
                    }}
                  >
                    {extraLabel}
                  </button>
                )}
                <button
                  className="rounded px-1.5 py-0.5 text-[11px] text-neutral-200 hover:bg-neutral-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    action([f]);
                  }}
                >
                  {actionLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FileChange["status"] }) {
  const map: Record<FileChange["status"], { letter: string; color: string }> = {
    modified: { letter: "M", color: "text-amber-400" },
    added: { letter: "A", color: "text-emerald-400" },
    deleted: { letter: "D", color: "text-red-400" },
    renamed: { letter: "R", color: "text-sky-400" },
    untracked: { letter: "?", color: "text-neutral-400" },
    conflicted: { letter: "U", color: "text-fuchsia-400" },
    typechange: { letter: "T", color: "text-violet-400" },
    ignored: { letter: "I", color: "text-neutral-600" },
  };
  const m = map[status];
  return <span className={`mono w-4 shrink-0 text-center text-xs ${m.color}`}>{m.letter}</span>;
}
