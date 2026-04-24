import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { gitStatusOptions } from "../../queries/gitApi";
import {
  mergeAbortMutation,
  rebaseAbortMutation,
  rebaseContinueMutation,
  rebaseSkipMutation,
} from "../../queries/mutations";
import { useConfirm } from "../ui/Confirm";
import { CheckIcon, CloseIcon } from "../ui/Icons";

export function ConflictList() {
  const activePath = useActiveTab()?.path;
  const status = useQuery(gitStatusOptions(activePath)).data ?? null;
  const rebaseContinueMut = useMutation(rebaseContinueMutation(activePath ?? ""));
  const rebaseAbortMut = useMutation(rebaseAbortMutation(activePath ?? ""));
  const rebaseSkipMut = useMutation(rebaseSkipMutation(activePath ?? ""));
  const mergeAbortMut = useMutation(mergeAbortMutation(activePath ?? ""));
  const selected = useUI((s) => s.selectedConflictFile);
  const selectConflictFile = useUI((s) => s.selectConflictFile);
  const setView = useUI((s) => s.setView);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const conflicts = status?.conflicted ?? [];

  const isRebase = !!status?.rebaseInProgress;
  const isMerge = !!status?.mergeInProgress;
  const canContinue = conflicts.length === 0 && (isRebase || isMerge);

  // Opening the merge view with nothing selected is a dead-end — the
  // editor just shows "select a file on the left." Auto-pick the first
  // conflict so the user lands straight in the resolver.
  //
  // This is *only* for the empty-selection case. Advancing the
  // selection after a resolve is MergeEditor's job (it computes the
  // next file BEFORE the mutation so the hand-off is race-free). If we
  // also reselected here when `selected` pointed at a resolved file,
  // we'd race the query refetch: the old `conflicts` list — still
  // containing the just-resolved file — would fire into this effect
  // right after MergeEditor set selection to null, and we'd put the
  // cursor back on the resolved file.
  useEffect(() => {
    if (selected || conflicts.length === 0) return;
    selectConflictFile(conflicts[0].path);
  }, [conflicts, selected, selectConflictFile]);

  async function finish() {
    try {
      if (isMerge) {
        // Merge commit is finished from the regular commit panel (which
        // pre-fills MERGE_MSG). Drop every right-panel selection so the
        // graph view lands straight on the changes panel — same
        // behavior as the editor's close button.
        const ui = useUI.getState();
        selectConflictFile(null);
        ui.selectCommit(null);
        ui.selectStash(null);
        ui.selectCommitFile(null);
        ui.selectWipFile(null);
        ui.selectStashFile(null);
        setView("graph");
      } else if (isRebase) {
        await rebaseContinueMut.mutateAsync();
        toast("success", "Rebase continued");
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function abort() {
    const ok = await confirmDialog({
      title: "Abort",
      message: "Abort and restore the previous state?",
      confirmLabel: "Abort",
      danger: true,
    });
    if (!ok) return;
    try {
      if (isMerge) await mergeAbortMut.mutateAsync();
      else if (isRebase) await rebaseAbortMut.mutateAsync();
      toast("success", "Aborted");
      selectConflictFile(null);
      setView("graph");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function skip() {
    try {
      await rebaseSkipMut.mutateAsync();
      toast("success", "Skipped");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-925">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-xs">
        <span className="flex-1 uppercase tracking-wider text-neutral-500">Conflicts</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
            conflicts.length > 0
              ? "bg-red-500/20 text-red-300"
              : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          {conflicts.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conflicts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-neutral-500">
            <CheckIcon className="size-5 text-emerald-400" />
            <span>No conflicts remaining</span>
          </div>
        ) : (
          <div className="py-0.5">
            {conflicts.map((f) => (
              <button
                key={f.path}
                onClick={() => selectConflictFile(f.path)}
                title={f.path}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition ${
                  selected === f.path
                    ? "bg-indigo-500/15 text-neutral-100"
                    : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
                }`}
              >
                <ConflictBadge />
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-neutral-800 p-2">
        <button
          onClick={finish}
          disabled={!canContinue}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          title={
            canContinue
              ? undefined
              : conflicts.length > 0
                ? "Resolve all conflicts first"
                : undefined
          }
        >
          <CheckIcon className="size-4" />
          {isRebase ? "Continue rebase" : "Continue merge"}
        </button>
        {isRebase && (
          <button
            onClick={skip}
            className="w-full rounded px-3 py-1.5 text-sm text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100"
          >
            Skip this commit
          </button>
        )}
        <button
          onClick={abort}
          className="flex w-full items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10"
        >
          <CloseIcon className="size-4" />
          Abort
        </button>
      </div>
    </aside>
  );
}

function ConflictBadge() {
  return (
    <span
      className="mono flex size-4 shrink-0 items-center justify-center rounded bg-red-500/30 text-[10px] font-bold text-red-300"
      title="unmerged"
    >
      U
    </span>
  );
}
