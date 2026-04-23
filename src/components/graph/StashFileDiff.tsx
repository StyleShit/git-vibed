import { useEffect, useMemo, useState } from "react";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { maybe } from "../../lib/ipc";
import { detectLanguage } from "../../lib/highlight";
import type { FileDiff } from "@shared/types";
import { ChevronRightIcon, CloseIcon } from "../ui/Icons";
import { SplitView, UnifiedView } from "./DiffView";

// Read-only diff for a file inside a stash — mirrors CommitFileDiff so
// the stash flow matches the commit flow: click a file in the right
// inspector, see the diff here in the main area.
export function StashFileDiff({ index, path }: { index: number; path: string }) {
  const selectStashFile = useUI((s) => s.selectStashFile);
  const viewMode = useSettings((s) => s.diffViewMode);
  const setViewMode = useSettings((s) => s.setDiffViewMode);
  const [file, setFile] = useState<FileDiff | null>(null);
  const lang = useMemo(() => detectLanguage(path), [path]);

  useEffect(() => {
    // Leave the previous diff on screen while the new one loads so
    // rapid file switches don't flash a "Loading diff…" placeholder
    // between every pair. Cancel flag prevents an older response
    // from clobbering newer state if the fetches race.
    let cancelled = false;
    void (async () => {
      const all = await maybe(window.gitApi.stashShowFiles(index));
      if (cancelled) return;
      const match = all?.find((f) => f.path === path) ?? null;
      setFile(match ?? { path, binary: false, hunks: [], raw: "" });
    })();
    return () => {
      cancelled = true;
    };
  }, [index, path]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2 text-xs">
        <span className="text-neutral-400">stash@{"{"}{index}{"}"}</span>
        <ChevronRightIcon className="size-3 text-neutral-600" />
        <span className="mono text-neutral-200">{path}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded border border-neutral-800 p-0.5">
            <ModeToggle
              active={viewMode === "unified"}
              onClick={() => setViewMode("unified")}
              label="Hunk"
            />
            <ModeToggle
              active={viewMode === "split"}
              onClick={() => setViewMode("split")}
              label="Split"
            />
          </div>
          <button
            onClick={() => selectStashFile(null)}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            title="Close diff (Esc)"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-neutral-950">
        {file === null ? (
          <div className="p-6 text-center text-sm text-neutral-500">Loading diff…</div>
        ) : file.binary ? (
          <div className="p-6 text-center text-sm text-neutral-500">Binary file</div>
        ) : file.hunks.length === 0 ? (
          <div className="p-6 text-center text-sm text-neutral-500">No changes</div>
        ) : viewMode === "split" ? (
          <SplitView diff={file} lang={lang} />
        ) : (
          <UnifiedView diff={file} lang={lang} />
        )}
      </div>
    </div>
  );
}

function ModeToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-[11px] ${
        active ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );
}
