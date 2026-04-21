import { useEffect, useState } from "react";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import type { Check, MergeMethod, PullRequest } from "@shared/types";

export function PRDetail() {
  const selected = useUI((s) => s.selectedPR);
  const selectPR = useUI((s) => s.selectPR);
  const toast = useUI((s) => s.toast);
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState(false);
  const [mergeMenu, setMergeMenu] = useState(false);
  const [reviewBody, setReviewBody] = useState("");

  useEffect(() => {
    if (selected == null) return;
    setPr(null);
    setChecks([]);
    void (async () => {
      try {
        const [detail, c] = await Promise.all([
          unwrap(window.ghApi.prView(selected)),
          unwrap(window.ghApi.prChecks(selected)),
        ]);
        setPr(detail);
        setChecks(c);
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    })();
  }, [selected, toast]);

  async function merge(method: MergeMethod) {
    if (!pr) return;
    if (!confirm(`Merge PR #${pr.number} with ${method}?`)) return;
    setBusy(true);
    setMergeMenu(false);
    try {
      await unwrap(window.ghApi.prMerge(pr.number, method));
      toast("success", "Merged");
      setPr({ ...pr, state: "MERGED" });
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function review(action: "approve" | "comment" | "request-changes") {
    if (!pr) return;
    setBusy(true);
    try {
      await unwrap(window.ghApi.prReview({ number: pr.number, action, body: reviewBody }));
      toast("success", `Review submitted (${action})`);
      setReviewBody("");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (selected == null) {
    return <div className="p-6 text-sm text-neutral-500">Select a PR</div>;
  }
  if (!pr) {
    return <div className="p-6 text-sm text-neutral-500">Loading…</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-neutral-800 px-6 py-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => selectPR(null)}
            className="text-neutral-500 hover:text-neutral-100"
            aria-label="back"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>#{pr.number}</span>
              <StateBadge state={pr.state} draft={pr.isDraft} />
            </div>
            <h1 className="mt-1 text-xl font-semibold">{pr.title}</h1>
            <div className="mt-1 text-xs text-neutral-400">
              {pr.author} wants to merge <span className="mono">{pr.headRefName}</span> into{" "}
              <span className="mono">{pr.baseRefName}</span>
            </div>
          </div>
          <button
            onClick={() => window.gitApi.openExternal(pr.url)}
            className="rounded px-3 py-1.5 text-xs hover:bg-neutral-800"
          >
            Open on GitHub ↗
          </button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-3 gap-6 p-6">
        <div className="col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">Description</h2>
          <pre className="mb-6 whitespace-pre-wrap rounded border border-neutral-800 bg-neutral-925 p-3 text-sm text-neutral-300">
            {pr.body || <span className="text-neutral-500">No description</span>}
          </pre>

          <h2 className="mb-2 text-sm font-semibold text-neutral-300">Review</h2>
          <textarea
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
            placeholder="Leave a review comment…"
            rows={3}
            className="mb-2 w-full rounded bg-neutral-800 p-2 text-sm outline-none"
          />
          <div className="flex gap-2">
            <button
              disabled={busy || pr.state !== "OPEN"}
              onClick={() => review("approve")}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              disabled={busy || pr.state !== "OPEN"}
              onClick={() => review("request-changes")}
              className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:opacity-50"
            >
              Request Changes
            </button>
            <button
              disabled={busy || !reviewBody.trim() || pr.state !== "OPEN"}
              onClick={() => review("comment")}
              className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
            >
              Comment
            </button>
          </div>
        </div>

        <aside>
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">Checks</h2>
          <ul className="mb-6 space-y-1 text-sm">
            {checks.length === 0 && <li className="text-neutral-500">No checks</li>}
            {checks.map((c) => (
              <li key={c.name} className="flex items-center gap-2">
                <CheckDot conclusion={c.conclusion} status={c.status} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.detailsUrl && (
                  <button
                    onClick={() => window.gitApi.openExternal(c.detailsUrl!)}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300"
                  >
                    details
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="relative">
            <button
              disabled={busy || pr.state !== "OPEN"}
              onClick={() => setMergeMenu(!mergeMenu)}
              className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Merge ▾
            </button>
            {mergeMenu && (
              <div
                className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-lg"
                onMouseLeave={() => setMergeMenu(false)}
              >
                <MergeItem onClick={() => merge("squash")}>Squash and merge</MergeItem>
                <MergeItem onClick={() => merge("merge")}>Create merge commit</MergeItem>
                <MergeItem onClick={() => merge("rebase")}>Rebase and merge</MergeItem>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MergeItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-800">
      {children}
    </button>
  );
}

function StateBadge({ state, draft }: { state: PullRequest["state"]; draft: boolean }) {
  if (draft) return <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px]">Draft</span>;
  const map = {
    OPEN: "bg-emerald-900/50 text-emerald-300",
    MERGED: "bg-violet-900/50 text-violet-300",
    CLOSED: "bg-red-900/50 text-red-300",
  } as const;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${map[state]}`}>{state}</span>;
}

function CheckDot({ conclusion, status }: { conclusion: string | null; status: string }) {
  let color = "bg-amber-400";
  if (status !== "COMPLETED") color = "bg-amber-400";
  else if (conclusion === "SUCCESS") color = "bg-emerald-500";
  else if (conclusion === "FAILURE") color = "bg-red-500";
  else if (conclusion === "NEUTRAL" || conclusion === "SKIPPED") color = "bg-neutral-500";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
