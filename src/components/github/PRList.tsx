import { useEffect, useMemo } from "react";
import { useActive, useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import type { PullRequest } from "@shared/types";

export function PRList({ filter }: { filter: string }) {
  const prs = useActive("prs") ?? [];
  const selectPR = useUI((s) => s.selectPR);
  const stateFilter = useSettings((s) => s.prStateFilter);
  const setStateFilter = useSettings((s) => s.setPrStateFilter);
  const refreshPRs = useRepo((s) => s.refreshPRs);

  // Re-fetch the PR list whenever the state filter changes so the list
  // reflects the selected bucket rather than the old one.
  useEffect(() => {
    void refreshPRs();
  }, [stateFilter, refreshPRs]);

  const filtered = useMemo(
    () =>
      prs.filter(
        (p) =>
          p.title.toLowerCase().includes(filter.toLowerCase()) ||
          p.headRefName.toLowerCase().includes(filter.toLowerCase()) ||
          p.author.toLowerCase().includes(filter.toLowerCase()) ||
          String(p.number).includes(filter),
      ),
    [prs, filter],
  );

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-neutral-800 px-2 py-1.5">
        {(["open", "closed", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStateFilter(s)}
            className={`rounded px-2 py-0.5 text-[11px] ${
              stateFilter === s
                ? "bg-neutral-700 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            }`}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {prs.length === 0 ? (
        <div className="p-3 text-xs text-neutral-500">
          {stateFilter === "all"
            ? "No pull requests"
            : `No ${stateFilter} pull requests`}
        </div>
      ) : (
        <ul className="p-1">
          {filtered.map((p) => (
            <li key={p.number}>
              <button
                onClick={() => selectPR(p.number)}
                className="w-full rounded px-2 py-2 text-left text-sm hover:bg-neutral-800"
              >
                <div className="flex items-center gap-2">
                  <StateDot state={p.state} decision={p.reviewDecision} />
                  <span className="mono text-xs text-neutral-500">#{p.number}</span>
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-neutral-500">
                  {p.headRefName} → {p.baseRefName} · {p.author}
                  {p.isDraft && " · draft"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StateDot({
  state,
  decision,
}: {
  state: PullRequest["state"];
  decision: PullRequest["reviewDecision"];
}) {
  // Closed / merged PRs get their own color so the list is scannable when
  // mixing states (under the "All" filter).
  let color: string;
  if (state === "MERGED") color = "bg-violet-500";
  else if (state === "CLOSED") color = "bg-red-500";
  else if (decision === "APPROVED") color = "bg-emerald-500";
  else if (decision === "CHANGES_REQUESTED") color = "bg-red-500";
  else color = "bg-amber-400";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
