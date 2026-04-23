import { useQuery } from "@tanstack/react-query";
import { useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { gitRemotesOptions } from "../../queries/gitApi";

export function RemoteList({ filter }: { filter: string }) {
  const activePath = useActiveTab()?.path;
  const remotes = useQuery(gitRemotesOptions(activePath)).data ?? [];
  const setView = useUI((s) => s.setView);
  const filtered = remotes.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="p-1">
      {filtered.map((r) => (
        <div key={r.name} className="rounded px-2 py-1.5 text-sm hover:bg-neutral-800" title={r.fetchUrl}>
          <div className="flex items-center">
            <span className="font-medium">{r.name}</span>
          </div>
          <div className="mono truncate text-[11px] text-neutral-500">{r.fetchUrl}</div>
        </div>
      ))}
      {remotes.length === 0 && (
        <div className="p-2 text-xs text-neutral-500">No remotes configured</div>
      )}
      <button
        onClick={() => setView("remotes")}
        className="mt-2 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
      >
        Manage Remotes…
      </button>
    </div>
  );
}
