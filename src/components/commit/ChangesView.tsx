import { useEffect, useState } from "react";
import { StagingArea } from "./StagingArea";
import { CommitPanel } from "./CommitPanel";
import { DiffViewer } from "./DiffViewer";
import { useRepo } from "../../stores/repo";

export function ChangesView() {
  const { status } = useRepo();
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null);

  // Clear selection when the file disappears from the change list.
  useEffect(() => {
    if (!selected || !status) return;
    const list = selected.staged ? status.staged : status.unstaged;
    if (!list.some((f) => f.path === selected.path)) setSelected(null);
  }, [status, selected]);

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-neutral-800">
        <StagingArea onSelect={setSelected} selected={selected} />
        <CommitPanel />
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <DiffViewer file={selected.path} staged={selected.staged} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            Select a file to see its diff
          </div>
        )}
      </div>
    </div>
  );
}
