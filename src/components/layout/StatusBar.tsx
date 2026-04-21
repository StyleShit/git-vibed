import { useActiveTabShallow } from "../../stores/repo";
import { useEffect, useState } from "react";
import { unwrap } from "../../lib/ipc";
import { useUI } from "../../stores/ui";
import { BranchIcon, FetchIcon } from "../ui/Icons";
import type { PullRequest } from "@shared/types";

export function StatusBar() {
  const { status, behindRemote, ghAvailable, prs } = useActiveTabShallow((t) => ({
    status: t?.status ?? null,
    behindRemote: t?.behindRemote ?? 0,
    ghAvailable: t?.ghAvailable ?? false,
    prs: t?.prs ?? [],
  }));
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
          <BranchIcon className="size-3" />
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
          className="flex items-center gap-1 hover:text-neutral-100"
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
          <FetchIcon className={`size-3 ${fetching ? "animate-pulse" : ""}`} />
          {fetching ? "Fetching…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

function computeCiDot(
  prs: PullRequest[],
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
