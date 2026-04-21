import { useUI } from "../../stores/ui";
import { useRepo } from "../../stores/repo";
import { BranchGraph } from "../graph/BranchGraph";
import { ChangesView } from "../commit/ChangesView";
import { RemotesPanel } from "../remotes/RemotesPanel";
import { SettingsPanel } from "../settings/SettingsPanel";
import { PRDetail } from "../github/PRDetail";
import { MergeEditor } from "../merge/MergeEditor";
import { ConflictList } from "../merge/ConflictList";

export function MainPanel() {
  const view = useUI((s) => s.view);
  const status = useRepo((s) => s.status);
  const inConflict = (status?.conflicted.length ?? 0) > 0;

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-neutral-950">
      <ViewTabs inConflict={inConflict} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "graph" && <BranchGraph />}
        {view === "changes" && <ChangesView />}
        {view === "remotes" && <RemotesPanel />}
        {view === "settings" && <SettingsPanel />}
        {view === "pr-detail" && <PRDetail />}
        {view === "merge" && (
          <div className="flex h-full">
            <ConflictList />
            <MergeEditor />
          </div>
        )}
      </div>
    </main>
  );
}

function ViewTabs({ inConflict }: { inConflict: boolean }) {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const status = useRepo((s) => s.status);
  const unstagedCount = (status?.unstaged.length ?? 0) + (status?.conflicted.length ?? 0);
  const stagedCount = status?.staged.length ?? 0;
  const changesBadge = unstagedCount + stagedCount;

  const tabs: Array<{ id: typeof view; label: string; badge?: number }> = [
    { id: "graph", label: "History" },
    { id: "changes", label: "Changes", badge: changesBadge || undefined },
  ];
  if (inConflict) tabs.push({ id: "merge", label: "Resolve Conflicts" });

  return (
    <div className="flex border-b border-neutral-800 bg-neutral-925 px-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setView(t.id)}
          className={`relative px-4 py-2 text-sm transition ${
            view === t.id ? "text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {t.label}
          {t.badge != null && (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] text-white">
              {t.badge}
            </span>
          )}
          {view === t.id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
          )}
        </button>
      ))}
    </div>
  );
}
