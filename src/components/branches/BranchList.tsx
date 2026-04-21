import { useMemo, useState } from "react";
import { useRepo, useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import type { Branch } from "@shared/types";
import { BranchContextMenu } from "./BranchContextMenu";
import { BranchCreateDialog } from "./BranchCreateDialog";
import { MergeRebaseDialog } from "./MergeRebaseDialog";

export function BranchList({ filter }: { filter: string }) {
  const branches = useActive("branches") ?? [];
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const [menu, setMenu] = useState<{ x: number; y: number; branch: Branch } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [mergeDialog, setMergeDialog] = useState<{ kind: "merge" | "rebase"; source: string } | null>(null);

  const { local, remote } = useMemo(() => {
    const f = filter.toLowerCase();
    const match = (b: Branch) => b.name.toLowerCase().includes(f);
    return {
      local: branches.filter((b) => b.isLocal && match(b)),
      remote: branches.filter((b) => b.isRemote && match(b)),
    };
  }, [branches, filter]);

  async function checkout(name: string) {
    try {
      await unwrap(window.gitApi.checkout(name));
      toast("success", `Switched to ${name}`);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="p-1">
      <div className="flex items-center justify-between px-2 py-1 text-xs uppercase tracking-wide text-neutral-500">
        <span>Local ({local.length})</span>
        <button
          onClick={() => setShowCreate(true)}
          className="text-indigo-400 hover:text-indigo-300"
        >
          + New
        </button>
      </div>
      {local.map((b) => (
        <BranchRow
          key={b.fullName}
          branch={b}
          onDoubleClick={() => checkout(b.name)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, branch: b });
          }}
        />
      ))}

      <div className="mt-2 px-2 py-1 text-xs uppercase tracking-wide text-neutral-500">
        Remote ({remote.length})
      </div>
      {remote.map((b) => (
        <BranchRow
          key={b.fullName}
          branch={b}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, branch: b });
          }}
        />
      ))}

      {menu && (
        <BranchContextMenu
          x={menu.x}
          y={menu.y}
          branch={menu.branch}
          onClose={() => setMenu(null)}
          onMerge={(src) => setMergeDialog({ kind: "merge", source: src })}
          onRebase={(src) => setMergeDialog({ kind: "rebase", source: src })}
        />
      )}
      {showCreate && <BranchCreateDialog onClose={() => setShowCreate(false)} />}
      {mergeDialog && (
        <MergeRebaseDialog
          kind={mergeDialog.kind}
          source={mergeDialog.source}
          onClose={() => setMergeDialog(null)}
        />
      )}
    </div>
  );
}

function BranchRow({
  branch,
  onDoubleClick,
  onContextMenu,
}: {
  branch: Branch;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`group flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-neutral-800 ${
        branch.isHead ? "bg-neutral-800" : ""
      }`}
      title={branch.fullName}
    >
      <div className="flex min-w-0 flex-1 items-center">
        {branch.isHead && <span className="mr-1.5 text-indigo-400">●</span>}
        <span className="truncate">{branch.name}</span>
      </div>
      {(branch.ahead ?? 0) + (branch.behind ?? 0) > 0 && (
        <div className="ml-2 flex shrink-0 items-center gap-1 text-[10px] text-neutral-500">
          {branch.ahead ? <span className="text-emerald-400">↑{branch.ahead}</span> : null}
          {branch.behind ? <span className="text-amber-400">↓{branch.behind}</span> : null}
        </div>
      )}
    </div>
  );
}
