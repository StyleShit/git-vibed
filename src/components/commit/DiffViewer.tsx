import { useEffect, useState } from "react";
import type { FileDiff } from "@shared/types";
import { unwrap } from "../../lib/ipc";
import { useUI } from "../../stores/ui";
import { useRepo } from "../../stores/repo";
import { buildHunkPatch, buildLinePatch } from "../../lib/patch-builder";

interface Props {
  file: string;
  staged: boolean;
}

export function DiffViewer({ file, staged }: Props) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useUI((s) => s.toast);
  const refreshStatus = useRepo((s) => s.refreshStatus);

  useEffect(() => {
    setDiff(null);
    setSelected(new Set());
    void (async () => {
      try {
        const d = await unwrap(window.gitApi.diff(file, { staged }));
        setDiff(d);
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    })();
  }, [file, staged, toast]);

  if (!diff) {
    return <div className="p-4 text-sm text-neutral-500">Loading diff…</div>;
  }
  if (diff.binary) {
    return <div className="p-4 text-sm text-neutral-500">Binary file — diff not shown</div>;
  }
  if (diff.hunks.length === 0) {
    return <div className="p-4 text-sm text-neutral-500">No changes</div>;
  }

  const toggleLine = (hunkIdx: number, lineIdx: number) => {
    const key = `${hunkIdx}:${lineIdx}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  async function applyHunk(hunkIdx: number) {
    try {
      const patch = buildHunkPatch(diff!.path, diff!.hunks[hunkIdx], diff!.oldPath);
      if (staged) await unwrap(window.gitApi.unstagePatch(patch));
      else await unwrap(window.gitApi.stagePatch(patch));
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function applySelectedLines() {
    try {
      // Build patches per hunk then concatenate.
      const patches: string[] = [];
      for (let h = 0; h < diff!.hunks.length; h++) {
        const hunk = diff!.hunks[h];
        const indexes = new Set<number>();
        for (let i = 0; i < hunk.lines.length; i++) {
          if (selected.has(`${h}:${i}`)) indexes.add(i);
        }
        if (indexes.size === 0) continue;
        const patch = buildLinePatch(diff!.path, hunk, indexes, diff!.oldPath);
        if (patch) patches.push(patch);
      }
      if (patches.length === 0) {
        toast("info", "Select at least one line first");
        return;
      }
      const combined = patches.join("");
      if (staged) await unwrap(window.gitApi.unstagePatch(combined));
      else await unwrap(window.gitApi.stagePatch(combined));
      setSelected(new Set());
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  const anySelected = selected.size > 0;
  const totalAdds = diff.hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.type === "add").length,
    0,
  );
  const totalDels = diff.hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.type === "del").length,
    0,
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3 py-2 text-xs">
        <div className="min-w-0 truncate">
          <span className="text-neutral-400">{staged ? "staged · " : ""}</span>
          <span className="text-neutral-200">{diff.path}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-emerald-400">+{totalAdds}</span>
          <span className="text-red-400">−{totalDels}</span>
          <button
            onClick={applySelectedLines}
            disabled={!anySelected}
            className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {staged ? "Unstage selected" : "Stage selected"}
          </button>
        </div>
      </div>
      <div className="mono min-h-0 flex-1 overflow-auto text-[12px] leading-5">
        {diff.hunks.map((hunk, hIdx) => (
          <div key={hIdx} className="border-b border-neutral-800">
            <div className="flex items-center justify-between bg-neutral-900 px-3 py-1 text-neutral-400">
              <span className="mono">{hunk.header}</span>
              <button
                onClick={() => applyHunk(hIdx)}
                className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-700"
              >
                {staged ? "Unstage hunk" : "Stage hunk"}
              </button>
            </div>
            <table className="w-full">
              <tbody>
                {hunk.lines.map((l, lIdx) => {
                  const key = `${hIdx}:${lIdx}`;
                  const bg =
                    l.type === "add"
                      ? "bg-emerald-900/25"
                      : l.type === "del"
                        ? "bg-red-900/25"
                        : "";
                  const selectable = l.type !== "context";
                  const isSelected = selected.has(key);
                  return (
                    <tr
                      key={lIdx}
                      className={`${bg} ${selectable ? "cursor-pointer hover:bg-neutral-800/40" : ""} ${isSelected ? "ring-1 ring-indigo-500" : ""}`}
                      onClick={() => selectable && toggleLine(hIdx, lIdx)}
                    >
                      <td className="w-8 px-2 text-right text-neutral-600">
                        {selectable && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleLine(hIdx, lIdx)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-3 w-3"
                          />
                        )}
                      </td>
                      <td className="w-10 px-2 text-right text-neutral-600">{l.oldLineNo ?? ""}</td>
                      <td className="w-10 px-2 text-right text-neutral-600">{l.newLineNo ?? ""}</td>
                      <td className="w-4 text-center text-neutral-500">
                        {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
                      </td>
                      <td className="whitespace-pre px-1 text-neutral-200">{l.content}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
