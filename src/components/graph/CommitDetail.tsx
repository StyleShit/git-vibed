import { useEffect, useState } from "react";
import { useRepo } from "../../stores/repo";
import type { Commit } from "@shared/types";

export function CommitDetail({ hash, onClose }: { hash: string; onClose: () => void }) {
  const commits = useRepo((s) => s.commits);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [files, setFiles] = useState<Array<{ path: string; added: number; removed: number }>>([]);

  useEffect(() => {
    const c = commits.find((x) => x.hash === hash) ?? null;
    setCommit(c);
  }, [hash, commits]);

  useEffect(() => {
    // Fetch the "diff --stat" for this commit via a raw log call. We don't
    // have a dedicated IPC for stat yet — reuse `diff` by passing commit^..commit.
    // Keep this lightweight: fall back to empty if we can't compute it.
    if (!commit) return;
    setFiles([]);
    void (async () => {
      // We can't fetch stats without a new IPC; so leave empty for now and
      // the file list stays minimalist. A future enhancement would add a
      // git:show-numstat channel.
    })();
  }, [commit]);

  if (!commit) return null;
  const date = new Date(commit.timestamp * 1000);

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-neutral-800 bg-neutral-925">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs">
        <div className="truncate text-neutral-400">Commit {commit.hash.slice(0, 7)}</div>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-100">
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
        <div className="mb-3 font-medium text-neutral-100">{commit.subject}</div>
        {commit.body && (
          <pre className="mb-3 whitespace-pre-wrap text-neutral-300">{commit.body}</pre>
        )}
        <dl className="space-y-1 text-xs text-neutral-400">
          <div>
            <dt className="inline text-neutral-500">Author </dt>
            <dd className="inline text-neutral-300">
              {commit.author} &lt;{commit.email}&gt;
            </dd>
          </div>
          <div>
            <dt className="inline text-neutral-500">Date </dt>
            <dd className="inline text-neutral-300">{date.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="inline text-neutral-500">Hash </dt>
            <dd className="mono inline text-neutral-300">{commit.hash}</dd>
          </div>
          <div>
            <dt className="inline text-neutral-500">Parents </dt>
            <dd className="mono inline text-neutral-300">
              {commit.parents.map((p) => p.slice(0, 7)).join(", ") || "-"}
            </dd>
          </div>
        </dl>
        {files.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Files</div>
            <ul className="mono text-xs">
              {files.map((f) => (
                <li key={f.path} className="flex justify-between py-0.5">
                  <span className="truncate">{f.path}</span>
                  <span className="shrink-0 pl-3">
                    <span className="text-emerald-400">+{f.added}</span>{" "}
                    <span className="text-red-400">−{f.removed}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
