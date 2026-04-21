import { useRepo } from "../../stores/repo";
import { useEffect, useState } from "react";
import { unwrap } from "../../lib/ipc";
import { useUI } from "../../stores/ui";

export function StatusBar() {
  const { status, behindRemote, ghAvailable, prs } = useRepo();
  const toast = useUI((s) => s.toast);
  const [fetching, setFetching] = useState(false);

  // Light pulse while an auto-fetch is in progress. We don't have a direct
  // signal for that today — hook into the manual fetch button UX here.
  useEffect(() => {
    if (!fetching) return;
    const t = setTimeout(() => setFetching(false), 1200);
    return () => clearTimeout(t);
  }, [fetching]);

  if (!status) {
    return (
      <div className="flex h-7 items-center justify-between border-t border-neutral-800 bg-neutral-925 px-3 text-xs text-neutral-500">
        <span>No repository</span>
      </div>
    );
  }

  const ciDot = computeCiDot(prs, status.branch ?? "");

  return (
    <div className="flex h-7 items-center justify-between border-t border-neutral-800 bg-neutral-925 px-3 text-xs text-neutral-400">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="6" cy="5" r="2" />
            <circle cx="6" cy="19" r="2" />
            <circle cx="18" cy="12" r="2" />
            <path d="M6 7v10M8 5h8a4 4 0 014 4v0M6 17V9a4 4 0 014-4h2" />
          </svg>
          {status.branch ?? "detached"}
        </span>
        {status.tracking && (
          <span>
            {status.ahead > 0 && <span className="text-emerald-400">↑{status.ahead}</span>}{" "}
            {status.behind > 0 && <span className="text-amber-400">↓{status.behind}</span>}
            {status.ahead === 0 && status.behind === 0 && <span>in sync</span>}
          </span>
        )}
        {behindRemote > 0 && (
          <span className="text-amber-400">{behindRemote} new commits on remote</span>
        )}
        {ghAvailable && ciDot && (
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${ciDot.color}`} />
            {ciDot.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {(status.mergeInProgress || status.rebaseInProgress) && (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">
            {status.mergeInProgress ? "MERGING" : "REBASING"}
          </span>
        )}
        <button
          className="hover:text-neutral-100"
          onClick={async () => {
            setFetching(true);
            try {
              await unwrap(window.gitApi.fetch({ all: true, prune: true }));
              toast("success", "Fetched");
            } catch (e) {
              toast("error", e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {fetching ? "Fetching…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

function computeCiDot(
  prs: ReturnType<typeof useRepo.getState>["prs"],
  branch: string,
): { color: string; label: string } | null {
  const myPr = prs.find((p) => p.headRefName === branch);
  if (!myPr) return null;
  // We don't yet have checks in the PR list payload — approximate with review
  // decision for now. Consumers can swap in a per-PR checks fetch if needed.
  if (myPr.reviewDecision === "APPROVED") return { color: "bg-emerald-500", label: "approved" };
  if (myPr.reviewDecision === "CHANGES_REQUESTED")
    return { color: "bg-red-500", label: "changes requested" };
  return { color: "bg-amber-400", label: "pending review" };
}
