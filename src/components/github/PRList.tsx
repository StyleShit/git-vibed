import { useMemo } from "react";
import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import type { PullRequest } from "@shared/types";

export function PRList({ filter }: { filter: string }) {
  const prs = useRepo((s) => s.prs);
  const selectPR = useUI((s) => s.selectPR);
  const filtered = useMemo(
    () =>
      prs.filter(
        (p) =>
          p.title.toLowerCase().includes(filter.toLowerCase()) ||
          p.headRefName.toLowerCase().includes(filter.toLowerCase()) ||
          String(p.number).includes(filter),
      ),
    [prs, filter],
  );

  if (prs.length === 0) {
    return <div className="p-3 text-xs text-neutral-500">No open pull requests</div>;
  }

  return (
    <ul className="p-1">
      {filtered.map((p) => (
        <li key={p.number}>
          <button
            onClick={() => selectPR(p.number)}
            className="w-full rounded px-2 py-2 text-left text-sm hover:bg-neutral-800"
          >
            <div className="flex items-center gap-2">
              <ReviewDot decision={p.reviewDecision} />
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
  );
}

function ReviewDot({ decision }: { decision: PullRequest["reviewDecision"] }) {
  const color =
    decision === "APPROVED"
      ? "bg-emerald-500"
      : decision === "CHANGES_REQUESTED"
        ? "bg-red-500"
        : "bg-amber-400";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
