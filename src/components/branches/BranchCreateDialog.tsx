import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog } from "../ui/Dialog";
import { useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import {
  gitBranchesOptions,
  gitStatusOptions,
} from "../../queries/gitApi";
import {
  branchCreateMutation,
  checkoutMutation,
} from "../../queries/mutations";

export function BranchCreateDialog({
  onClose,
  initialBase,
}: {
  onClose: () => void;
  initialBase?: string;
}) {
  const activePath = useActiveTab()?.path;
  const branches = useQuery(gitBranchesOptions(activePath)).data ?? [];
  const status = useQuery(gitStatusOptions(activePath)).data ?? null;
  const branchCreateMut = useMutation(branchCreateMutation(activePath ?? ""));
  const checkoutMut = useMutation(checkoutMutation(activePath ?? ""));
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState("");
  const [base, setBase] = useState(initialBase ?? status?.branch ?? "HEAD");
  const [checkout, setCheckout] = useState(true);
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await branchCreateMut.mutateAsync({ name: name.trim(), base });
      if (checkout) await checkoutMut.mutateAsync(name.trim());
      toast("success", `Created ${name.trim()}`);
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
