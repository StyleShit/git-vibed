import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { useConfirm } from "../ui/Confirm";
import { CheckIcon, CloseIcon } from "../ui/Icons";

export function ConflictList() {
  const status = useActive("status") ?? null;
  const refreshAll = useRepo((s) => s.refreshAll);
  const selected = useUI((s) => s.selectedConflictFile);
  const selectConflictFile = useUI((s) => s.selectConflictFile);
  const setView = useUI((s) => s.setView);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const conflicts = status?.conflicted ?? [];

  const isRebase = !!status?.rebaseInProgress;
  const isMerge = !!status?.mergeInProgress;
  const canContinue = conflicts.length === 0 && (isRebase || isMerge);

  async function finish() {
    try {
      if (isMerge) {
        // Merge commit is finished from the regular commit panel (which
        // pre-fills MERGE_MSG) — here we only leave the editor so the
        // user sees that panel.
        selectConflictFile(null);
        setView("graph");
      } else if (isRebase) {
        await unwrap(window.gitApi.rebaseContinue());
        toast("success", "Rebase continued");
        await refreshAll();
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
      if (isMerge) await unwrap(window.gitApi.mergeAbort());
      else if (isRebase) await unwrap(window.gitApi.rebaseAbort());
      toast("success", "Aborted");
      selectConflictFile(null);
      setView("graph");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function skip() {
    try {
      await unwrap(window.gitApi.rebaseSkip());
      toast("success", "Skipped");
      await refreshAll();
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
