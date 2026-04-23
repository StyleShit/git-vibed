import { useState } from "react";
import { Dialog } from "../ui/Dialog";
import { useRepo, useActiveTabShallow } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";

// Create a lightweight or annotated tag at an arbitrary ref. Mirrors
// `git tag [-a <name> -m <msg>] [<ref>]`. When a message is provided we
// create an annotated tag (object stored in refs/tags) so it carries the
// message + tagger identity; otherwise a plain lightweight ref.
export function TagCreateDialog({
  onClose,
  initialRef,
}: {
  onClose: () => void;
  initialRef?: string;
}) {
  const { branches, status } = useActiveTabShallow((t) => ({
    branches: t?.branches ?? [],
    status: t?.status ?? null,
  }));
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(initialRef ?? status?.branch ?? "HEAD");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await unwrap(window.gitApi.tagCreate(n, target, message.trim() || undefined));
      toast("success", `Created tag ${n}`);
      await refreshAll();
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Create Tag" onClose={onClose}>
      <label className="mb-1 block text-xs text-neutral-400">Name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="v1.2.3"
        className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
      />

      <label className="mb-1 block text-xs text-neutral-400">At</label>
      {initialRef ? (
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mono mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-xs outline-none"
        />
      ) : (
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none"
        >
          <option value="HEAD">HEAD</option>
          {branches
            .filter((b) => b.isLocal || b.isRemote)
            .map((b) => (
              <option key={b.fullName} value={b.name}>
                {b.name}
              </option>
            ))}
        </select>
      )}

      <label className="mb-1 block text-xs text-neutral-400">
        Message <span className="text-neutral-600">(optional — creates annotated tag)</span>
      </label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder="Release notes, etc."
        className="mb-4 w-full resize-y rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
      />

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
