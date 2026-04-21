import { useState } from "react";
import { Dialog } from "../ui/Dialog";
import { unwrap } from "../../lib/ipc";
import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";

// Edit the fetch/push URLs of an existing remote. Blank push URL is
// treated as "reuse the fetch URL" — matching `git remote -v` behavior.
// Only sends the IPC calls that actually change something to avoid
// churning refs on a no-op save.
export function EditRemoteDialog({
  name,
  initialFetchUrl,
  initialPushUrl,
  onClose,
}: {
  name: string;
  initialFetchUrl: string;
  initialPushUrl: string;
  onClose: () => void;
}) {
  const toast = useUI((s) => s.toast);
  const refreshRemotes = useRepo((s) => s.refreshRemotes);
  const [fetchUrl, setFetchUrl] = useState(initialFetchUrl);
  const [pushUrl, setPushUrl] = useState(
    initialPushUrl === initialFetchUrl ? "" : initialPushUrl,
  );
  const [busy, setBusy] = useState(false);

  const nextFetch = fetchUrl.trim();
  const nextPush = pushUrl.trim() || nextFetch;
  const canSubmit = nextFetch.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (nextFetch !== initialFetchUrl) {
        await unwrap(window.gitApi.remoteSetUrl(name, nextFetch, false));
      }
      if (nextPush !== initialPushUrl) {
        await unwrap(window.gitApi.remoteSetUrl(name, nextPush, true));
      }
      toast("success", `Updated URLs for ${name}`);
      await refreshRemotes();
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Set URLs for ${name}`} onClose={onClose}>
      <label className="mb-1 block text-xs text-neutral-400">Fetch URL</label>
      <input
        autoFocus
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
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Dialog>
  );
}
