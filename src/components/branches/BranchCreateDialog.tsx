import { useState } from "react";
import { Dialog } from "../ui/Dialog";
import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";

export function BranchCreateDialog({ onClose }: { onClose: () => void }) {
  const { branches, status, refreshAll } = useRepo();
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState("");
  const [base, setBase] = useState(status?.branch ?? "HEAD");
  const [checkout, setCheckout] = useState(true);
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (checkout) {
        // One shot: create + switch. Lightweight — simpler than two IPC calls.
        await unwrap(window.gitApi.branchCreate(name.trim(), base));
        await unwrap(window.gitApi.checkout(name.trim()));
      } else {
        await unwrap(window.gitApi.branchCreate(name.trim(), base));
      }
      toast("success", `Created ${name.trim()}`);
      await refreshAll();
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Create Branch" onClose={onClose}>
      <label className="mb-1 block text-xs text-neutral-400">Name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="feature/my-branch"
        className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <label className="mb-1 block text-xs text-neutral-400">Base</label>
      <select
        value={base}
        onChange={(e) => setBase(e.target.value)}
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
      <label className="mb-4 flex items-center gap-2 text-xs text-neutral-400">
        <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
        Checkout after create
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800">
          Cancel
        </button>
        <button
          onClick={onCreate}
          disabled={busy || !name.trim()}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </Dialog>
  );
}
