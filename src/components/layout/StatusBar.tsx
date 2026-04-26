import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActivePath, useRepo } from "../../stores/repo";
import { useSettings } from "../../stores/settings";
import {
  gitStatusOptions,
  ghAvailableOptions,
  prsOptions,
} from "../../queries/gitApi";
import { BranchIcon } from "../ui/Icons";
import type { PullRequest } from "@shared/types";

export function StatusBar() {
  const path = useActivePath();
  const behindRemote = useRepo(
    (s) => s.tabs[s.activeIdx]?.behindRemote ?? 0,
  );
  const prStateFilter = useSettings((s) => s.prStateFilter);
  const status = useQuery(gitStatusOptions(path)).data ?? null;
  const ghAvailable = useQuery(ghAvailableOptions(path)).data ?? false;
  const prs = useQuery(prsOptions(path, prStateFilter, ghAvailable)).data ?? [];

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
          <TrackingBadge
            ahead={status.ahead}
            behind={status.behind}
            behindRemote={behindRemote}
          />
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
      </div>
    </div>
  );
}

function TrackingBadge({
  ahead,
  behind,
  behindRemote,
}: {
  ahead: number;
  behind: number;
  behindRemote: number;
}) {
  // Auto-fetch reports a fresher behind count than `git status`, which
  // only updates on a status refresh. Prefer it when available.
  const behindCount = useMemo(
    () => (behindRemote > 0 ? behindRemote : behind),
    [behindRemote, behind],
  );
  if (ahead === 0 && behindCount === 0) return null;
  return (
    <span>
      {ahead > 0 && <span className="text-emerald-400">↑{ahead}</span>}{" "}
      {behindCount > 0 && (
        <span
          className="text-amber-400"
          title={`${behindCount} new commit${behindCount === 1 ? "" : "s"} on remote`}
        >
          ↓{behindCount}
        </span>
      )}
    </span>
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
