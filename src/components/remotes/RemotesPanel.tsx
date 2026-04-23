import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { gitRemotesOptions } from "../../queries/gitApi";
import {
  remoteAddMutation,
  remoteRemoveMutation,
  remoteSetUrlMutation,
} from "../../queries/mutations";
import { Dialog } from "../ui/Dialog";
import { useConfirm } from "../ui/Confirm";
import type { Remote } from "@shared/types";

export function RemotesPanel() {
  const activePath = useActiveTab()?.path;
  const remotes = useQuery(gitRemotesOptions(activePath)).data ?? [];
  const remoteRemoveMut = useMutation(remoteRemoveMutation(activePath ?? ""));
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const [editing, setEditing] = useState<Remote | null>(null);
  const [adding, setAdding] = useState(false);

  async function remove(name: string) {
    const ok = await confirmDialog({
      title: `Remove remote "${name}"?`,
      message: "The remote configuration is deleted; the repository is unaffected.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await remoteRemoveMut.mutateAsync(name);
      toast("success", `Removed ${name}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Remotes</h2>
        <button
          onClick={() => setAdding(true)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500"
        >
          + Add Remote
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase text-neutral-500">
            <th className="pb-2">Name</th>
            <th className="pb-2">Fetch URL</th>
            <th className="pb-2">Push URL</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {remotes.map((r) => (
            <tr key={r.name} className="border-b border-neutral-900">
              <td className="py-2 font-medium">{r.name}</td>
              <td className="mono py-2 text-neutral-300">{r.fetchUrl}</td>
              <td className="mono py-2 text-neutral-300">{r.pushUrl}</td>
              <td className="py-2 text-right">
                <button
                  onClick={() => setEditing(r)}
                  className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(r.name)}
                  className="rounded px-2 py-1 text-xs text-red-400 hover:bg-neutral-800"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {remotes.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-sm text-neutral-500">
                No remotes
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {adding && <AddDialog onClose={() => setAdding(false)} />}
      {editing && <EditDialog remote={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const activePath = useActiveTab()?.path;
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useUI((s) => s.toast);
  const remoteAddMut = useMutation(remoteAddMutation(activePath ?? ""));

  async function save() {
    setBusy(true);
    try {
      await remoteAddMut.mutateAsync({ name: name.trim(), url: url.trim() });
      toast("success", `Added ${name.trim()}`);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Add Remote" onClose={onClose}>
      <label className="mb-1 block text-xs text-neutral-400">Name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none"
      />
      <label className="mb-1 block text-xs text-neutral-400">URL</label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="git@github.com:owner/repo.git"
        className="mb-4 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!name.trim() || !url.trim() || busy}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </Dialog>
  );
}

function EditDialog({ remote, onClose }: { remote: Remote; onClose: () => void }) {
  const activePath = useActiveTab()?.path;
  const [fetchUrl, setFetchUrl] = useState(remote.fetchUrl);
  const [pushUrl, setPushUrl] = useState(remote.pushUrl);
  const [busy, setBusy] = useState(false);
  const toast = useUI((s) => s.toast);
  const remoteSetUrlMut = useMutation(remoteSetUrlMutation(activePath ?? ""));

  async function save() {
    setBusy(true);
    try {
      if (fetchUrl !== remote.fetchUrl) {
        await remoteSetUrlMut.mutateAsync({ name: remote.name, url: fetchUrl, push: false });
      }
      if (pushUrl !== remote.pushUrl) {
        await remoteSetUrlMut.mutateAsync({ name: remote.name, url: pushUrl, push: true });
      }
      toast("success", "Saved");
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Edit ${remote.name}`} onClose={onClose}>
      <label className="mb-1 block text-xs text-neutral-400">Fetch URL</label>
      <input
        value={fetchUrl}
        onChange={(e) => setFetchUrl(e.target.value)}
        className="mono mb-3 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none"
      />
      <label className="mb-1 block text-xs text-neutral-400">Push URL</label>
      <input
        value={pushUrl}
        onChange={(e) => setPushUrl(e.target.value)}
        className="mono mb-4 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
