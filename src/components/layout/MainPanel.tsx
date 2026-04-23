import { useQuery } from "@tanstack/react-query";
import { useUI } from "../../stores/ui";
import { useActiveTab, useRepo } from "../../stores/repo";
import { gitStatusOptions } from "../../queries/gitApi";
import { BranchGraph } from "../graph/BranchGraph";
import { RemotesPanel } from "../remotes/RemotesPanel";
import { SettingsPanel } from "../settings/SettingsPanel";
import { PRDetail } from "../github/PRDetail";
import { MergeEditor } from "../merge/MergeEditor";
import { ConflictList } from "../merge/ConflictList";
import { Spinner } from "../ui/Spinner";
import { useConfirm } from "../ui/Confirm";
import { unwrap } from "../../lib/ipc";

export function MainPanel() {
  const view = useUI((s) => s.view);
  const activeTab = useActiveTab();
  const statusQuery = useQuery(gitStatusOptions(activeTab?.path));
  const status = statusQuery.data ?? null;
  const mergeInProgress = !!status?.mergeInProgress;
  const rebaseInProgress = !!status?.rebaseInProgress;
  const inConflict = (status?.conflicted.length ?? 0) > 0;
  // The banner is useful any time a merge/rebase is live — including the
  // "all resolved, ready to commit" lull — so the user can always reach
  // the editor or abort without digging through menus.
  const showBanner =
    (mergeInProgress || rebaseInProgress) && view !== "merge";

  // Render a loader only on the initial repo open when we don't have any
  // data yet — background refetches shouldn't black out the graph.
  const initialLoading = !!activeTab && statusQuery.isPending;

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-neutral-950">
      {showBanner && (
        <ConflictBanner
          mode={mergeInProgress ? "merge" : "rebase"}
          hasConflicts={inConflict}
        />
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {initialLoading ? (
          <RepoLoading />
        ) : (
          <>
            {/* Keying BranchGraph on the repo path remounts its virtualized
                scroll state + memoized layout when the active tab switches,
                so the history view always reflects the current tab. */}
            {view === "graph" && <BranchGraph key={activeTab?.path ?? "none"} />}
            {view === "remotes" && <RemotesPanel />}
            {view === "settings" && <SettingsPanel />}
            {view === "pr-detail" && <PRDetail />}
            {view === "merge" && (
              <div className="flex h-full">
                <ConflictList />
                <MergeEditor />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function RepoLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-400">
      <Spinner size={28} />
      <div className="text-sm">Opening repository…</div>
    </div>
  );
}

function ConflictBanner({
  mode,
  hasConflicts,
}: {
  mode: "merge" | "rebase";
  hasConflicts: boolean;
}) {
  const setView = useUI((s) => s.setView);
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);
  const confirmDialog = useConfirm();

  async function abort() {
    const ok = await confirmDialog({
      title: `Abort ${mode}`,
      message: "Abort and restore the previous state?",
      confirmLabel: "Abort",
      danger: true,
    });
    if (!ok) return;
    try {
      if (mode === "merge") await unwrap(window.gitApi.mergeAbort());
      else await unwrap(window.gitApi.rebaseAbort());
      toast("success", "Aborted");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-amber-600/40 bg-amber-500/10 px-3 text-xs text-amber-200">
      <span className="flex-1">
        {hasConflicts
          ? `${mode === "merge" ? "Merge" : "Rebase"} in progress — conflicts remaining.`
          : `${mode === "merge" ? "Merge" : "Rebase"} in progress — ready to commit.`}
      </span>
      {hasConflicts && (
        <button
          onClick={() => setView("merge")}
          className="rounded px-2 py-0.5 text-amber-100 transition hover:bg-amber-500/20"
        >
          Open editor
        </button>
      )}
      <button
        onClick={abort}
        className="rounded px-2 py-0.5 text-red-300 transition hover:bg-red-500/15"
      >
        Abort {mode}
      </button>
    </div>
  );
}
