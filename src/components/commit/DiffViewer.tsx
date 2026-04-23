import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { DiffHunk, DiffLine, FileDiff } from "@shared/types";
import { unwrap } from "../../lib/ipc";
import { useUI } from "../../stores/ui";
import { useActiveTab } from "../../stores/repo";
import { useSettings } from "../../stores/settings";
import { buildHunkPatch, buildLinePatch } from "../../lib/patch-builder";
import {
  stagePatchMutation,
  unstagePatchMutation,
} from "../../queries/mutations";

interface Props {
  file: string;
  staged: boolean;
}

// Per-line selection key: hunkIdx:lineIdx. Same identifier works for either
// view mode so toggling the layout doesn't clear selection.
const key = (h: number, l: number) => `${h}:${l}`;

export function DiffViewer({ file, staged }: Props) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useUI((s) => s.toast);
  const activePath = useActiveTab()?.path ?? "";
  const stagePatchMut = useMutation(stagePatchMutation(activePath));
  const unstagePatchMut = useMutation(unstagePatchMutation(activePath));
  const viewMode = useSettings((s) => s.diffViewMode);
  const setViewMode = useSettings((s) => s.setDiffViewMode);

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

  const toggleLine = (h: number, l: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = key(h, l);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  async function applyHunk(hunkIdx: number) {
    if (!diff) return;
    try {
      const patch = buildHunkPatch(diff.path, diff.hunks[hunkIdx], diff.oldPath);
      if (staged) await unstagePatchMut.mutateAsync(patch);
      else await stagePatchMut.mutateAsync(patch);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function applySelectedLines() {
    if (!diff) return;
    try {
      const patches: string[] = [];
      for (let h = 0; h < diff.hunks.length; h++) {
        const hunk = diff.hunks[h];
        const indexes = new Set<number>();
        for (let i = 0; i < hunk.lines.length; i++) {
          if (selected.has(key(h, i))) indexes.add(i);
        }
        if (indexes.size === 0) continue;
        const patch = buildLinePatch(diff.path, hunk, indexes, diff.oldPath);
        if (patch) patches.push(patch);
      }
      if (patches.length === 0) {
        toast("info", "Select at least one line first");
        return;
      }
      const combined = patches.join("");
      if (staged) await unstagePatchMut.mutateAsync(combined);
      else await stagePatchMut.mutateAsync(combined);
      setSelected(new Set());
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  if (!diff) return <div className="p-4 text-sm text-neutral-500">Loading diff…</div>;
  if (diff.binary) return <div className="p-4 text-sm text-neutral-500">Binary file — diff not shown</div>;
  if (diff.hunks.length === 0) return <div className="p-4 text-sm text-neutral-500">No changes</div>;

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
          <ViewToggle value={viewMode} onChange={setViewMode} />
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
            {viewMode === "unified" ? (
              <UnifiedHunk hunk={hunk} hunkIdx={hIdx} selected={selected} onToggle={toggleLine} />
            ) : (
              <SplitHunk hunk={hunk} hunkIdx={hIdx} selected={selected} onToggle={toggleLine} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: "unified" | "split";
  onChange: (v: "unified" | "split") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-neutral-700 text-[11px]">
      <button
        onClick={() => onChange("unified")}
        className={`px-2 py-0.5 ${
          value === "unified" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
        }`}
      >
        Unified
      </button>
      <button
        onClick={() => onChange("split")}
        className={`px-2 py-0.5 ${
          value === "split" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
        }`}
      >
        Split
      </button>
    </div>
  );
}

function UnifiedHunk({
  hunk,
  hunkIdx,
  selected,
  onToggle,
}: {
  hunk: DiffHunk;
  hunkIdx: number;
  selected: Set<string>;
  onToggle: (h: number, l: number) => void;
}) {
  return (
    <table className="w-full">
      <tbody>
        {hunk.lines.map((l, lIdx) => {
          const k = key(hunkIdx, lIdx);
          const bg =
            l.type === "add"
              ? "bg-emerald-900/25"
              : l.type === "del"
                ? "bg-red-900/25"
                : "";
          const selectable = l.type !== "context";
          const isSelected = selected.has(k);
          return (
            <tr
              key={lIdx}
              className={`${bg} ${selectable ? "cursor-pointer hover:bg-neutral-800/40" : ""} ${isSelected ? "ring-1 ring-indigo-500" : ""}`}
              onClick={() => selectable && onToggle(hunkIdx, lIdx)}
            >
              <td className="w-8 px-2 text-right text-neutral-600">
                {selectable && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(hunkIdx, lIdx)}
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
  );
}

// Pair adjacent del/add lines into a single row so modifications display
// side-by-side. Unmatched dels/adds fill just one side of the row.
interface SplitRow {
  left: { line: DiffLine; idx: number } | null;
  right: { line: DiffLine; idx: number } | null;
}

function buildSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let pendingDels: Array<{ line: DiffLine; idx: number }> = [];
  const flushDels = () => {
    for (const d of pendingDels) rows.push({ left: d, right: null });
    pendingDels = [];
  };
  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    if (line.type === "context") {
      flushDels();
      rows.push({ left: { line, idx: i }, right: { line, idx: i } });
    } else if (line.type === "del") {
      pendingDels.push({ line, idx: i });
    } else if (line.type === "add") {
      const pair = pendingDels.shift();
      if (pair) rows.push({ left: pair, right: { line, idx: i } });
      else rows.push({ left: null, right: { line, idx: i } });
    }
  }
  flushDels();
  return rows;
}

function SplitHunk({
  hunk,
  hunkIdx,
  selected,
  onToggle,
}: {
  hunk: DiffHunk;
  hunkIdx: number;
  selected: Set<string>;
  onToggle: (h: number, l: number) => void;
}) {
  const rows = useMemo(() => buildSplitRows(hunk), [hunk]);
  return (
    <table className="w-full table-fixed">
      <colgroup>
        <col style={{ width: "3.25rem" }} />
        <col style={{ width: "calc(50% - 1.625rem)" }} />
        <col style={{ width: "3.25rem" }} />
        <col style={{ width: "calc(50% - 1.625rem)" }} />
      </colgroup>
      <tbody>
        {rows.map((row, rIdx) => (
          <tr key={rIdx}>
            <SideCell side="left" cell={row.left} hunkIdx={hunkIdx} selected={selected} onToggle={onToggle} />
            <ContentCell
              side="left"
              cell={row.left}
              hunkIdx={hunkIdx}
              selected={selected}
              onToggle={onToggle}
            />
            <SideCell side="right" cell={row.right} hunkIdx={hunkIdx} selected={selected} onToggle={onToggle} />
            <ContentCell
              side="right"
              cell={row.right}
              hunkIdx={hunkIdx}
              selected={selected}
              onToggle={onToggle}
            />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Line-number + sign gutter. Kept narrow and monospace.
function SideCell({
  side,
  cell,
  hunkIdx,
  selected,
  onToggle,
}: {
  side: "left" | "right";
  cell: SplitRow["left"];
  hunkIdx: number;
  selected: Set<string>;
  onToggle: (h: number, l: number) => void;
}) {
  if (!cell) return <td className="bg-neutral-900/40" />;
  const { line, idx } = cell;
  const isSelectable = line.type !== "context";
  const isSelected = selected.has(key(hunkIdx, idx));
  const lineNo = side === "left" ? line.oldLineNo : line.newLineNo;
  const sign = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";
  return (
    <td
      onClick={() => isSelectable && onToggle(hunkIdx, idx)}
      className={`px-2 text-right align-top text-neutral-600 ${isSelectable ? "cursor-pointer" : ""} ${isSelected ? "ring-1 ring-indigo-500" : ""}`}
    >
      <span className="inline-block w-6 pr-1">{lineNo ?? ""}</span>
      <span className="inline-block w-3 text-center">{sign}</span>
    </td>
  );
}

function ContentCell({
  cell,
  hunkIdx,
  selected,
  onToggle,
}: {
  side: "left" | "right";
  cell: SplitRow["left"];
  hunkIdx: number;
  selected: Set<string>;
  onToggle: (h: number, l: number) => void;
}) {
  if (!cell) return <td className="bg-neutral-900/40" />;
  const { line, idx } = cell;
  const isSelectable = line.type !== "context";
  const isSelected = selected.has(key(hunkIdx, idx));
  const bg =
    line.type === "add"
      ? "bg-emerald-900/25"
      : line.type === "del"
        ? "bg-red-900/25"
        : "";
  return (
    <td
      onClick={() => isSelectable && onToggle(hunkIdx, idx)}
      className={`whitespace-pre px-2 text-neutral-200 ${bg} ${isSelectable ? "cursor-pointer hover:bg-neutral-800/40" : ""} ${isSelected ? "ring-1 ring-indigo-500" : ""}`}
    >
      {line.content}
    </td>
  );
}
