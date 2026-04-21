import { useMemo, useState } from "react";
import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { BranchList } from "../branches/BranchList";
import { PRList } from "../github/PRList";
import { RemoteList } from "../remotes/RemoteList";

type Section = "branches" | "remotes" | "prs";

export function Sidebar() {
  const { ghAvailable } = useRepo();
  const [section, setSection] = useState<Section>("branches");
  const [filter, setFilter] = useState("");

  const sections = useMemo(() => {
    const s: Array<{ id: Section; label: string }> = [
      { id: "branches", label: "Branches" },
      { id: "remotes", label: "Remotes" },
    ];
    if (ghAvailable) s.push({ id: "prs", label: "Pull Requests" });
    return s;
  }, [ghAvailable]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-925">
      <div className="flex border-b border-neutral-800">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`flex-1 px-3 py-2 text-xs font-medium transition ${
              section === s.id
                ? "bg-neutral-900 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="border-b border-neutral-800 p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="w-full rounded bg-neutral-800 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === "branches" && <BranchList filter={filter} />}
        {section === "remotes" && <RemoteList filter={filter} />}
        {section === "prs" && <PRList filter={filter} />}
      </div>
      <SidebarFooter />
    </aside>
  );
}

function SidebarFooter() {
  const { repoPath } = useRepo();
  const setView = useUI((s) => s.setView);
  if (!repoPath) return null;
  const name = repoPath.split(/[\\/]/).pop();
  return (
    <div className="flex items-center justify-between border-t border-neutral-800 px-3 py-2">
      <div className="min-w-0 truncate text-xs text-neutral-400" title={repoPath}>
        {name}
      </div>
      <button
        className="text-xs text-neutral-400 hover:text-neutral-100"
        onClick={() => setView("settings")}
      >
        Settings
      </button>
    </div>
  );
}
