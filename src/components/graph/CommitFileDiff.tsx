import { useEffect, useMemo, useState } from "react";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { maybe } from "../../lib/ipc";
import { detectLanguage } from "../../lib/highlight";
import type { FileDiff } from "@shared/types";
import { ChevronRightIcon, CloseIcon } from "../ui/Icons";
import { SplitView, UnifiedView } from "./DiffView";

// Read-only diff for a file at a specific commit — shown in the center
// panel when a file is clicked inside CommitDetail. Supports unified &
// side-by-side view modes, sharing the SettingsStore preference with the
// WIP diff so toggling it in one place sticks everywhere.
export function CommitFileDiff({ hash, path }: { hash: string; path: string }) {
  const selectCommitFile = useUI((s) => s.selectCommitFile);
  const viewMode = useSettings((s) => s.diffViewMode);
  const setViewMode = useSettings((s) => s.setDiffViewMode);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const lang = useMemo(() => detectLanguage(path), [path]);

  useEffect(() => {
    setDiff(null);
    void (async () => {
      const d = await maybe(
        window.gitApi.diff(path, { commitA: `${hash}^`, commitB: hash }),
      );
      setDiff(d ?? { path, binary: false, hunks: [], raw: "" });
    })();
  }, [hash, path]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2 text-xs">
        <span className="mono text-neutral-400">{hash.slice(0, 7)}</span>
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
            onClick={() => selectCommitFile(null)}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            title="Close diff (Esc)"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-neutral-950">
        {diff === null ? (
          <div className="p-6 text-center text-sm text-neutral-500">Loading diff…</div>
        ) : diff.binary ? (
          <div className="p-6 text-center text-sm text-neutral-500">Binary file</div>
        ) : diff.hunks.length === 0 ? (
          <div className="p-6 text-center text-sm text-neutral-500">No changes</div>
        ) : viewMode === "split" ? (
          <SplitView diff={diff} lang={lang} />
        ) : (
          <UnifiedView diff={diff} lang={lang} />
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
