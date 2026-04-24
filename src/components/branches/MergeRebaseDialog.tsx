import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog } from "../ui/Dialog";
import { useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { gitStatusOptions } from "../../queries/gitApi";
import {
  mergeMutation,
  rebaseMutation,
} from "../../queries/mutations";

export function MergeRebaseDialog({
  kind,
  source,
  onClose,
}: {
  kind: "merge" | "rebase";
  source: string;
  onClose: () => void;
}) {
  const activePath = useActiveTab()?.path;
  const status = useQuery(gitStatusOptions(activePath)).data ?? null;
  const mergeMut = useMutation(mergeMutation(activePath ?? ""));
  const rebaseMut = useMutation(rebaseMutation(activePath ?? ""));
  const toast = useUI((s) => s.toast);
  const setView = useUI((s) => s.setView);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const result =
        kind === "merge"
          ? await mergeMut.mutateAsync(source)
          : await rebaseMut.mutateAsync(source);
      if (result.conflicts.length > 0) {
        toast("info", `Conflicts in ${result.conflicts.length} file(s)`);
        setView("merge");
      } else {
        toast("success", kind === "merge" ? "Merged" : "Rebased");
      }
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={kind === "merge" ? "Merge" : "Rebase"} onClose={onClose}>
      <p className="mb-4 text-sm text-neutral-300">
        {kind === "merge" ? (
          <>
            Merge <b>{source}</b> into <b>{status?.branch}</b>?
          </>
        ) : (
          <>
            Rebase <b>{status?.branch}</b> onto <b>{source}</b>?
          </>
        )}
      </p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800">
          Cancel
        </button>
        <button
          onClick={run}
          disabled={busy}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Running…" : kind === "merge" ? "Merge" : "Rebase"}
        </button>
      </div>
    </Dialog>
  );
}
