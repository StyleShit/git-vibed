import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog } from "../ui/Dialog";
import { useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import {
  remoteAddMutation,
  remoteSetUrlMutation,
} from "../../queries/mutations";

// Two-field dialog for `git remote add`, with an optional separate push
// URL. Leaving the push URL blank matches git's default of reusing the
// fetch URL for both directions.
export function AddRemoteDialog({ onClose }: { onClose: () => void }) {
  const activePath = useActiveTab()?.path;
  const toast = useUI((s) => s.toast);
  const remoteAddMut = useMutation(remoteAddMutation(activePath ?? ""));
  const remoteSetUrlMut = useMutation(remoteSetUrlMutation(activePath ?? ""));
  const [name, setName] = useState("");
  const [fetchUrl, setFetchUrl] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit =
    name.trim().length > 0 && fetchUrl.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const n = name.trim();
      const fu = fetchUrl.trim();
      await remoteAddMut.mutateAsync({ name: n, url: fu });
      // Distinct push URL — `git remote add` doesn't take it directly, so
      // we layer `git remote set-url --push` right after.
      if (pushUrl.trim() && pushUrl.trim() !== fu) {
        await remoteSetUrlMut.mutateAsync({ name: n, url: pushUrl.trim(), push: true });
      }
      toast("success", `Added remote ${n}`);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Add remote" onClose={onClose}>
      <label className="mb-1 block text-xs text-neutral-400">Name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="origin"
        className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <label className="mb-1 block text-xs text-neutral-400">Fetch URL</label>
      <input
        value={fetchUrl}
        onChange={(e) => setFetchUrl(e.target.value)}
        placeholder="git@github.com:owner/repo.git"
        className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <label className="mb-1 block text-xs text-neutral-400">
        Push URL <span className="text-neutral-600">(optional — defaults to fetch)</span>
      </label>
      <input
        value={pushUrl}
        onChange={(e) => setPushUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
        placeholder="same as fetch"
        className="mb-4 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add remote"}
        </button>
      </div>
    </Dialog>
  );
}
