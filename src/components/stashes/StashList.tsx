import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveTab, useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { gitStashesOptions } from "../../queries/gitApi";
import { StashIcon, BranchIcon } from "../ui/Icons";
import { useConfirm } from "../ui/Confirm";
import { Tooltip } from "../ui/Tooltip";
import type { Stash } from "@shared/types";

export function StashList({ filter }: { filter: string }) {
  const activePath = useActiveTab()?.path;
  const stashes = useQuery(gitStashesOptions(activePath)).data ?? [];
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const selectStash = useUI((s) => s.selectStash);
  const selectedStash = useUI((s) => s.selectedStash);
  const [busy, setBusy] = useState<number | null>(null);
  const filterLC = filter.trim().toLowerCase();

  const filtered = filterLC
    ? stashes.filter(
        (s) =>
          s.message.toLowerCase().includes(filterLC) ||
          s.branch?.toLowerCase().includes(filterLC),
      )
    : stashes;

  async function apply(stash: Stash, pop: boolean) {
    setBusy(stash.index);
    try {
      if (pop && stash.index === 0) {
        await unwrap(window.gitApi.stashPop());
      } else {
        await unwrap(window.gitApi.stashApply(stash.index));
        if (pop) await unwrap(window.gitApi.stashDrop(stash.index));
      }
      toast("success", pop ? "Popped stash" : "Applied stash");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function drop(stash: Stash) {
    const ok = await confirmDialog({
      title: "Drop stash",
      message: `Drop ${stash.ref}?\nThis can't be undone.`,
      confirmLabel: "Drop",
      danger: true,
    });
    if (!ok) return;
    setBusy(stash.index);
    try {
      await unwrap(window.gitApi.stashDrop(stash.index));
      toast("success", "Dropped stash");
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (stashes.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-neutral-500">
        No stashes. Use <span className="text-neutral-300">Stash</span> in the toolbar to save
        work for later.
      </div>
    );
  }

  return (
    <div className="py-1">
      {filtered.map((s) => (
        <StashRow
          key={s.ref}
          stash={s}
          busy={busy === s.index}
          active={selectedStash === s.index}
          onSelect={() => selectStash(s.index)}
          onApply={apply}
          onDrop={drop}
        />
      ))}
    </div>
  );
}

function StashRow({
  stash,
  busy,
  active,
  onSelect,
  onApply,
  onDrop,
}: {
  stash: Stash;
  busy: boolean;
  active: boolean;
  onSelect: () => void;
  onApply: (s: Stash, pop: boolean) => void;
  onDrop: (s: Stash) => void;
}) {
  // Strip the "WIP on <branch>: <hash> " prefix for a cleaner subject.
  const subject = stash.message.replace(/^(?:WIP )?[Oo]n [^:]+:\s*(?:[0-9a-f]{7,}\s+)?/i, "");
  return (
    <div
      onClick={onSelect}
      className={`group relative flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm ${
        active ? "bg-indigo-500/15" : "hover:bg-neutral-800"
      }`}
    >
      <StashIcon className="size-3.5 shrink-0 text-neutral-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-neutral-200" title={stash.message}>
          {subject || stash.message}
        </div>
        {stash.branch && (
          <div className="flex items-center gap-1 text-[10px] text-neutral-500" title={stash.branch}>
            <BranchIcon className="size-2.5" />
            <span className="truncate">{stash.branch}</span>
          </div>
        )}
      </div>
      <div
        className="absolute inset-y-0.5 right-1 hidden items-center gap-0.5 rounded bg-neutral-800/95 px-1 shadow-lg backdrop-blur-sm group-hover:flex"
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip content="Apply">
          <button
            onClick={() => onApply(stash, false)}
            disabled={busy}
            className="rounded px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
          >
            apply
          </button>
        </Tooltip>
        <Tooltip content="Pop (apply + drop)">
          <button
            onClick={() => onApply(stash, true)}
            disabled={busy}
            className="rounded px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
          >
            pop
          </button>
        </Tooltip>
        <Tooltip content="Drop">
          <button
            onClick={() => onDrop(stash)}
            disabled={busy}
            className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-neutral-700"
          >
            drop
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
