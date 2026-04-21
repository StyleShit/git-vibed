import { useUI } from "../../stores/ui";
import { useActive, useActiveTab } from "../../stores/repo";
import { BranchGraph } from "../graph/BranchGraph";
import { RemotesPanel } from "../remotes/RemotesPanel";
import { SettingsPanel } from "../settings/SettingsPanel";
import { PRDetail } from "../github/PRDetail";
import { MergeEditor } from "../merge/MergeEditor";
import { ConflictList } from "../merge/ConflictList";
import { Spinner } from "../ui/Spinner";

export function MainPanel() {
  const view = useUI((s) => s.view);
  const status = useActive("status") ?? null;
  const loading = useActive("loading") ?? false;
  const commits = useActive("commits") ?? [];
  const activeTab = useActiveTab();
  const inConflict = (status?.conflicted.length ?? 0) > 0;

  // Render a loader only on the initial repo open when we don't have any
  // data yet — background refreshes shouldn't black out the graph.
  const initialLoading = loading && commits.length === 0 && !status;

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-neutral-950">
      {inConflict && <ConflictBanner />}
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

// Merge/rebase conflict state used to be a tab; with the single-view layout
// we surface it as a slim banner with a "Resolve conflicts" action that
// swaps to the merge editor, and a "Back" once the user is editing.
function ConflictBanner() {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-b border-amber-600/40 bg-amber-500/10 px-3 text-xs text-amber-200">
      <span>Merge conflicts in this working tree.</span>
      {view === "merge" ? (
        <button
          onClick={() => setView("graph")}
          className="rounded px-2 py-0.5 text-amber-100 hover:bg-amber-500/20"
        >
          ← Back to history
        </button>
      ) : (
        <button
          onClick={() => setView("merge")}
          className="rounded bg-amber-500/30 px-2 py-0.5 text-amber-100 hover:bg-amber-500/50"
        >
          Resolve conflicts →
        </button>
      )}
    </div>
  );
}
