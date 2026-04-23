import { useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { useRepo, useActiveTabShallow } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";

// Create a new git worktree at a user-picked filesystem path. Two modes:
//   - checkout an existing branch (local or remote)
//   - create a new branch at the chosen base and check that out
// For "new branch" we create the branch first (at the chosen base) then
// add the worktree as a plain checkout — this keeps the executor API
// flat and avoids shelling out to `git worktree add -b name path base`,
// which has subtler argv rules across git versions.
export function WorktreeAddDialog({ onClose }: { onClose: () => void }) {
  const { branches, repoPath } = useActiveTabShallow((t) => ({
    branches: t?.branches ?? [],
    repoPath: t?.path ?? null,
  }));
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const defaultBranch = branches.find((b) => b.isHead)?.name ?? "main";
  const [existingBranch, setExistingBranch] = useState(defaultBranch);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchBase, setNewBranchBase] = useState(defaultBranch);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  // Suggest "<repoParent>/<repoName>-<branch>" when the user hasn't
  // typed anything yet, matching what they'd likely want anyway.
  const suggestedPath = useMemo(() => {
    if (!repoPath) return "";
    const branch = mode === "existing" ? existingBranch : newBranchName;
    const safe = (branch || "worktree").replace(/[\\/]/g, "-");
    const sep = repoPath.includes("\\") ? "\\" : "/";
    const segments = repoPath.split(/[\\/]/);
    const name = segments.pop() || "repo";
    return segments.join(sep) + sep + `${name}-${safe}`;
  }, [repoPath, mode, existingBranch, newBranchName]);

  const effectivePath = path.trim() || suggestedPath;

  async function browse() {
    try {
      const res = await window.gitApi.showOpenDialog();
      if (res.ok) setPath(res.data);
    } catch (e) {
      if (e instanceof Error && e.message === "User cancelled") return;
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function onAdd() {
    if (!effectivePath) return;
    setBusy(true);
    try {
      if (mode === "existing") {
        await unwrap(window.gitApi.worktreeAdd(effectivePath, existingBranch, false));
      } else {
        const name = newBranchName.trim();
        if (!name) {
          toast("error", "Branch name is required");
          setBusy(false);
          return;
        }
        // Create the branch at the chosen base first, then check it out
        // into the new worktree. This avoids the `-b name path base`
        // form whose argv ordering has changed subtly between git
        // versions and keeps the rollback story simple (if the
        // worktree add fails we still have a clean new branch).
        await unwrap(window.gitApi.branchCreate(name, newBranchBase));
        await unwrap(window.gitApi.worktreeAdd(effectivePath, name, false));
      }
      toast("success", "Added worktree");
      await refreshAll();
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Add Worktree" onClose={onClose} width={520}>
      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setMode("existing")}
          className={`flex-1 rounded px-2 py-1.5 text-xs ${
            mode === "existing"
              ? "bg-indigo-600 text-white"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          Checkout existing branch
        </button>
        <button
          onClick={() => setMode("new")}
          className={`flex-1 rounded px-2 py-1.5 text-xs ${
            mode === "new"
              ? "bg-indigo-600 text-white"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          Create new branch
        </button>
      </div>

      {mode === "existing" ? (
        <>
          <label className="mb-1 block text-xs text-neutral-400">Branch</label>
          <select
            value={existingBranch}
            onChange={(e) => setExistingBranch(e.target.value)}
            className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none"
          >
            {branches
              .filter((b) => b.isLocal || b.isRemote)
              .map((b) => (
                <option key={b.fullName} value={b.name}>
                  {b.name}
                </option>
              ))}
          </select>
        </>
      ) : (
        <>
          <label className="mb-1 block text-xs text-neutral-400">New branch name</label>
          <input
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="feature/my-branch"
            className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <label className="mb-1 block text-xs text-neutral-400">Base</label>
          <select
            value={newBranchBase}
            onChange={(e) => setNewBranchBase(e.target.value)}
            className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none"
          >
            {branches
              .filter((b) => b.isLocal || b.isRemote)
              .map((b) => (
                <option key={b.fullName} value={b.name}>
                  {b.name}
                </option>
              ))}
          </select>
        </>
      )}

      <label className="mb-1 block text-xs text-neutral-400">Path</label>
      <div className="mb-4 flex gap-2">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={suggestedPath}
          className="mono flex-1 rounded bg-neutral-800 px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          onClick={browse}
          className="rounded bg-neutral-800 px-2 py-1.5 text-xs hover:bg-neutral-700"
        >
          Browse…
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800">
          Cancel
        </button>
        <button
          onClick={onAdd}
          disabled={busy || !effectivePath || (mode === "new" && !newBranchName.trim())}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Add"}
        </button>
      </div>
    </Dialog>
  );
}
