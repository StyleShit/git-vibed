import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useActiveTab, useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { gitWorktreesOptions } from "../../queries/gitApi";
import {
  worktreeLockMutation,
  worktreeRemoveMutation,
  worktreeUnlockMutation,
} from "../../queries/mutations";
import { WorktreeIcon, LockIcon, BranchIcon } from "../ui/Icons";
import { useConfirm } from "../ui/Confirm";
import type { Worktree } from "@shared/types";

export function WorktreeList({ filter }: { filter: string }) {
  const activePath = useActiveTab()?.path;
  const worktrees = useQuery(gitWorktreesOptions(activePath)).data ?? [];
  const worktreeRemoveMut = useMutation(worktreeRemoveMutation(activePath ?? ""));
  const worktreeLockMut = useMutation(worktreeLockMutation(activePath ?? ""));
  const worktreeUnlockMut = useMutation(worktreeUnlockMutation(activePath ?? ""));
  const openRepo = useRepo((s) => s.openRepo);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const filterLC = filter.trim().toLowerCase();

  const filtered = filterLC
    ? worktrees.filter(
        (w) =>
          w.path.toLowerCase().includes(filterLC) ||
          w.branch?.toLowerCase().includes(filterLC),
      )
    : worktrees;

  async function open(w: Worktree) {
    try {
      await openRepo(w.path);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(w: Worktree) {
    if (w.isMain) {
      toast("error", "Can't remove the main worktree");
      return;
    }
    const ok = await confirmDialog({
      title: "Remove worktree",
      message: `Remove worktree at ${w.path}?`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setBusy(w.path);
    try {
      await worktreeRemoveMut.mutateAsync({ path: w.path });
      toast("success", "Removed worktree");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleLock(w: Worktree) {
    setBusy(w.path);
    try {
      if (w.isLocked) {
        await worktreeUnlockMut.mutateAsync(w.path);
        toast("success", "Unlocked");
      } else {
        await worktreeLockMut.mutateAsync({ path: w.path });
        toast("success", "Locked");
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (worktrees.length === 0) {
    return <div className="px-3 py-4 text-xs text-neutral-500">No worktrees.</div>;
  }

  return (
    <div className="py-1">
      {filtered.map((w) => {
        const name = w.path.split(/[\\/]/).pop() ?? w.path;
        return (
          <div
            key={w.path}
            onDoubleClick={() => open(w)}
            className="group relative flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-neutral-800"
            title={w.path}
          >
            <WorktreeIcon className="size-3.5 shrink-0 text-neutral-500" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-neutral-200">
                <span className="truncate">{name}</span>
                {w.isMain && (
                  <span className="shrink-0 rounded bg-indigo-500/20 px-1 text-[9px] text-indigo-300">
                    main
                  </span>
                )}
                {w.isLocked && <LockIcon className="size-2.5 shrink-0 text-amber-400" />}
              </div>
              {w.branch && (
                <div className="flex items-center gap-1 text-[10px] text-neutral-500" title={w.branch}>
                  <BranchIcon className="size-2.5" />
                  <span className="truncate">{w.branch}</span>
                </div>
              )}
            </div>
            {/* Actions float over the row on hover instead of reserving
                space, so the title + branch text always gets full width. */}
            <div
              className="absolute inset-y-0.5 right-1 hidden items-center gap-0.5 rounded bg-neutral-800/95 px-1 shadow-lg backdrop-blur-sm group-hover:flex"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => open(w)}
                disabled={busy === w.path}
                className="rounded px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
                title="Open in new tab"
              >
                open
              </button>
              {!w.isMain && (
                <>
                  <button
                    onClick={() => toggleLock(w)}
                    disabled={busy === w.path}
                    className="rounded px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
                  >
                    {w.isLocked ? "unlock" : "lock"}
                  </button>
                  <button
                    onClick={() => remove(w)}
                    disabled={busy === w.path}
                    className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-neutral-700"
                  >
                    remove
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
