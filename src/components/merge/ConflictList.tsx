import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";

export function ConflictList() {
  const status = useActive("status") ?? null;
  const refreshAll = useRepo((s) => s.refreshAll);
  const selected = useUI((s) => s.selectedConflictFile);
  const selectConflictFile = useUI((s) => s.selectConflictFile);
  const toast = useUI((s) => s.toast);
  const conflicts = status?.conflicted ?? [];

  async function finish() {
    try {
      if (status?.mergeInProgress) {
        // Once all files are staged, a commit completes the merge.
        toast("info", "Commit from the Changes tab to complete the merge");
      } else if (status?.rebaseInProgress) {
        await unwrap(window.gitApi.rebaseContinue());
        toast("success", "Rebase continued");
        await refreshAll();
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function abort() {
    if (!confirm("Abort and restore previous state?")) return;
    try {
      if (status?.mergeInProgress) await unwrap(window.gitApi.mergeAbort());
      else if (status?.rebaseInProgress) await unwrap(window.gitApi.rebaseAbort());
      toast("success", "Aborted");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-neutral-800">
      <div className="border-b border-neutral-800 px-3 py-2 text-xs uppercase tracking-wide text-neutral-400">
        Conflicts ({conflicts.length})
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conflicts.length === 0 && (
          <div className="p-3 text-sm text-neutral-500">No conflicts remaining</div>
        )}
        {conflicts.map((f) => (
          <button
            key={f.path}
            onClick={() => selectConflictFile(f.path)}
            className={`block w-full truncate px-3 py-2 text-left text-sm ${
              selected === f.path ? "bg-neutral-800" : "hover:bg-neutral-900"
            }`}
            title={f.path}
          >
            <span className="mono mr-2 text-fuchsia-400">U</span>
            {f.path}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-neutral-800 p-2">
        <button
          onClick={finish}
          disabled={conflicts.length > 0}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {status?.rebaseInProgress ? "Continue Rebase" : "Continue Merge"}
        </button>
        <button onClick={abort} className="rounded px-3 py-1.5 text-sm text-red-400 hover:bg-neutral-800">
          Abort
        </button>
        {status?.rebaseInProgress && (
          <button
            onClick={async () => {
              try {
                await unwrap(window.gitApi.rebaseSkip());
                await refreshAll();
              } catch (e) {
                toast("error", e instanceof Error ? e.message : String(e));
              }
            }}
            className="rounded px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Skip this commit
          </button>
        )}
      </div>
    </div>
  );
}
