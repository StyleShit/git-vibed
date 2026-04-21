import { useEffect, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { useRepo, useActiveTabShallow } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap, maybe } from "../../lib/ipc";

export function PRCreateDialog({
  onClose,
  headBranch,
}: {
  onClose: () => void;
  // Override which branch gets used as the PR head. When omitted we fall
  // back to the currently checked-out branch, matching the older UX.
  headBranch?: string;
}) {
  const { status, branches } = useActiveTabShallow((t) => ({
    status: t?.status ?? null,
    branches: t?.branches ?? [],
  }));
  const refreshPRs = useRepo((s) => s.refreshPRs);
  const toast = useUI((s) => s.toast);
  const head = headBranch ?? status?.branch ?? "";
  const [title, setTitle] = useState(head);
  const [body, setBody] = useState("");
  const [base, setBase] = useState("main");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [collabs, setCollabs] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const info = await maybe(window.ghApi.repoInfo());
      if (info) setBase(info.defaultBranch);
      const c = await maybe(window.ghApi.collaborators());
      if (c) setCollabs(c);
    })();
  }, []);

  async function create() {
    setBusy(true);
    try {
      const pr = await unwrap(
        window.ghApi.prCreate({ title, body, base, head, draft, reviewers }),
      );
      toast("success", `Opened PR #${pr.number}`);
      await refreshPRs();
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Create Pull Request" onClose={onClose} width={560}>
      <div className="mb-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <label className="mb-1 block text-neutral-400">Base</label>
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm"
          >
            {branches
              .filter((b) => b.isLocal || b.isRemote)
              .map((b) => (
                <option key={b.fullName} value={b.name}>
                  {b.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-neutral-400">Head</label>
          <input
            disabled
            value={head}
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-500"
          />
        </div>
      </div>
      <label className="mb-1 block text-xs text-neutral-400">Title</label>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none"
      />
      <label className="mb-1 block text-xs text-neutral-400">Body</label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        placeholder="Describe the change (supports markdown)"
        className="mono mb-3 w-full resize-y rounded bg-neutral-800 p-2 text-sm outline-none"
      />
      {collabs.length > 0 && (
        <>
          <label className="mb-1 block text-xs text-neutral-400">Reviewers</label>
          <div className="mb-3 flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded bg-neutral-800 p-2">
            {collabs.map((c) => (
              <label key={c} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-neutral-700">
                <input
                  type="checkbox"
                  checked={reviewers.includes(c)}
                  onChange={(e) =>
                    setReviewers((cur) =>
                      e.target.checked ? [...cur, c] : cur.filter((x) => x !== c),
                    )
                  }
                />
                {c}
              </label>
            ))}
          </div>
        </>
      )}
      <label className="mb-4 flex items-center gap-2 text-xs text-neutral-400">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        Create as draft
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800">
          Cancel
        </button>
        <button
          onClick={create}
          disabled={busy || !title.trim() || !base}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create Pull Request"}
        </button>
      </div>
    </Dialog>
  );
}
