import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveTab, useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { gitTagsOptions } from "../../queries/gitApi";
import { TagIcon } from "../ui/Icons";
import { useConfirm } from "../ui/Confirm";
import type { Tag } from "@shared/types";

export function TagList({ filter }: { filter: string }) {
  const activePath = useActiveTab()?.path;
  const tags = useQuery(gitTagsOptions(activePath)).data ?? [];
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const filterLC = filter.trim().toLowerCase();

  // Newest-first by leveraging the commit hash as a proxy is wrong, so we
  // just show them alphabetically for now. For a smarter order we'd need
  // a timestamp per tag, which for-each-ref can provide later.
  const filtered = filterLC
    ? tags.filter((t) => t.name.toLowerCase().includes(filterLC))
    : tags;

  async function del(t: Tag) {
    const ok = await confirmDialog({
      title: `Delete tag ${t.name}?`,
      message: "Use push --tags to sync the deletion to remote.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy(t.name);
    try {
      await unwrap(window.gitApi.tagDelete(t.name));
      toast("success", `Deleted ${t.name}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (tags.length === 0) {
    return <div className="px-3 py-4 text-xs text-neutral-500">No tags.</div>;
  }

  return (
    <div className="py-1">
      {filtered.map((t) => (
        <div
          key={t.name}
          className="group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-neutral-800"
          title={t.message || t.name}
        >
          <TagIcon
            className={`size-3.5 shrink-0 ${
              t.annotated ? "text-amber-400" : "text-neutral-500"
            }`}
          />
          <span className="min-w-0 flex-1 truncate text-neutral-200">{t.name}</span>
          <span className="mono shrink-0 text-[10px] text-neutral-600">
            {t.commit.slice(0, 7)}
          </span>
          <button
            onClick={() => del(t)}
            disabled={busy === t.name}
            className="rounded px-1 text-[10px] text-red-400 opacity-0 transition hover:bg-neutral-700 group-hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
