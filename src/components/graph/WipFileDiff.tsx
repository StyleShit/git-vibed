import { useEffect, useMemo, useState } from "react";
import { useUI } from "../../stores/ui";
import { useRepo } from "../../stores/repo";
import { unwrap } from "../../lib/ipc";
import { useSettings } from "../../stores/settings";
import { buildHunkPatch, buildLinePatch } from "../../lib/patch-builder";
import { detectLanguage } from "../../lib/highlight";
import type { FileDiff } from "@shared/types";
import { ChevronRightIcon, CloseIcon } from "../ui/Icons";
import { SplitView, UnifiedView, type HunkAction } from "./DiffView";
import { useConfirm } from "../ui/Confirm";

// Uncommitted diff view — shown in the main panel when a file is selected
// in the Changes inspector. Supports hunk (unified) and side-by-side modes
// and lets the user stage/unstage/discard at the hunk or line level.
const key = (h: number, l: number) => `${h}:${l}`;

export function WipFileDiff({ path, staged }: { path: string; staged: boolean }) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<{ h: number; l: number } | null>(null);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const selectWipFile = useUI((s) => s.selectWipFile);
  const refreshStatus = useRepo((s) => s.refreshStatus);
  const viewMode = useSettings((s) => s.diffViewMode);
  const setViewMode = useSettings((s) => s.setDiffViewMode);
  const lang = useMemo(() => detectLanguage(path), [path]);

  useEffect(() => {
    setDiff(null);
    setSelected(new Set());
    void (async () => {
      try {
        const d = await unwrap(window.gitApi.diff(path, { staged }));
        setDiff(d);
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    })();
  }, [path, staged, toast]);

  // Click toggles one line; shift-click extends from the last-clicked line
  // to the current one inclusive. Range selection only covers the same hunk
  // since cross-hunk ranges rarely produce a meaningful patch.
  const toggleLine = (h: number, l: number, shift = false) => {
    if (shift && lastClicked && lastClicked.h === h && diff) {
      const from = Math.min(lastClicked.l, l);
      const to = Math.max(lastClicked.l, l);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          if (diff.hunks[h]?.lines[i]?.type !== "context") next.add(key(h, i));
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        const k = key(h, l);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
    }
    setLastClicked({ h, l });
  };

  // Atomic toggle for split-view paired rows (del on the left + add on the
  // right representing a single logical modification). Using the first
  // side's selection as the pivot keeps both halves in sync — if any of
  // the lines is currently selected we deselect the whole group, otherwise
  // select all of them.
  const toggleLines = (lines: Array<{ h: number; l: number }>, shift = false) => {
    if (lines.length === 0) return;
    if (shift && lastClicked && diff) {
      // Shift-click: fall through to the single-line range handler using
      // the first line of the group as the anchor.
      toggleLine(lines[0].h, lines[0].l, true);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      const anyOn = lines.some(({ h, l }) => next.has(key(h, l)));
      if (anyOn) {
        for (const { h, l } of lines) next.delete(key(h, l));
      } else {
        for (const { h, l } of lines) next.add(key(h, l));
      }
      return next;
    });
    setLastClicked({ h: lines[0].h, l: lines[0].l });
  };

  // "Visual" selection count — a del followed by an add at consecutive
  // hunk indices represents a single modification row, so we count that
  // pair as one. Pure deletions, pure insertions, and stand-alone picks
  // each count as one. Drives the button label so "Stage N lines"
  // matches what the user sees selected in split mode.
  const visualLineCount = useMemo(() => {
    if (!diff) return selected.size;
    const byHunk = new Map<number, number[]>();
    for (const k of selected) {
      const [h, l] = k.split(":").map(Number);
      const arr = byHunk.get(h) ?? [];
      arr.push(l);
      byHunk.set(h, arr);
    }
    let count = 0;
    for (const [h, lines] of byHunk) {
      lines.sort((a, b) => a - b);
      const hunk = diff.hunks[h];
      for (let i = 0; i < lines.length; i++) {
        const cur = lines[i];
        const next = lines[i + 1];
        if (
          next === cur + 1 &&
          hunk?.lines[cur]?.type === "del" &&
          hunk?.lines[next]?.type === "add"
        ) {
          count += 1;
          i += 1; // skip the paired add
        } else {
          count += 1;
        }
      }
    }
    return count;
  }, [selected, diff]);

  async function applyHunk(hunkIdx: number) {
    if (!diff) return;
    const patch = buildHunkPatch(diff.path, diff.hunks[hunkIdx], diff.oldPath);
    try {
      if (staged) {
        await unwrap(window.gitApi.unstagePatch(patch));
        toast("success", "Unstaged hunk");
      } else {
        await unwrap(window.gitApi.stagePatch(patch));
        toast("success", "Staged hunk");
      }
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function discardHunk(hunkIdx: number) {
    if (!diff || staged) return;
    const ok = await confirmDialog({
      title: "Discard hunk",
      message: "Discard this hunk?\nThis cannot be undone.",
      confirmLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
    const patch = buildHunkPatch(diff.path, diff.hunks[hunkIdx], diff.oldPath);
    try {
      await unwrap(window.gitApi.discardPatch(patch));
      toast("success", "Discarded hunk");
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function applyLines() {
    if (!diff || selected.size === 0) return;
    const patches: string[] = [];
    for (let h = 0; h < diff.hunks.length; h++) {
      const indexes = new Set<number>();
      for (let i = 0; i < diff.hunks[h].lines.length; i++) {
        if (selected.has(key(h, i))) indexes.add(i);
      }
      if (indexes.size === 0) continue;
      const p = buildLinePatch(diff.path, diff.hunks[h], indexes, diff.oldPath);
      if (p) patches.push(p);
    }
    if (patches.length === 0) return;
    const combined = patches.join("");
    try {
      if (staged) {
        await unwrap(window.gitApi.unstagePatch(combined));
        toast("success", "Unstaged selection");
      } else {
        await unwrap(window.gitApi.stagePatch(combined));
        toast("success", "Staged selection");
      }
      setSelected(new Set());
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function discardLines() {
    if (!diff || selected.size === 0 || staged) return;
    const ok = await confirmDialog({
      title: "Discard selection",
      message: `Discard ${selected.size} selected lines?\nThis cannot be undone.`,
      confirmLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
    const patches: string[] = [];
    for (let h = 0; h < diff.hunks.length; h++) {
      const indexes = new Set<number>();
      for (let i = 0; i < diff.hunks[h].lines.length; i++) {
        if (selected.has(key(h, i))) indexes.add(i);
      }
      if (indexes.size === 0) continue;
      const p = buildLinePatch(diff.path, diff.hunks[h], indexes, diff.oldPath);
      if (p) patches.push(p);
    }
    if (patches.length === 0) return;
    try {
      await unwrap(window.gitApi.discardPatch(patches.join("")));
      toast("success", "Discarded selection");
      setSelected(new Set());
      await refreshStatus();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  const hunkActions: HunkAction[] = [
    {
      label: staged ? "Unstage hunk" : "Stage hunk",
      onClick: applyHunk,
    },
    ...(!staged
      ? [
          {
            label: "Discard hunk",
            onClick: discardHunk,
            danger: true,
            title: "Discard this hunk",
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2 text-xs">
        <span className="text-neutral-400">{staged ? "Staged" : "Changes"}</span>
        <ChevronRightIcon className="size-3 text-neutral-600" />
        <span className="mono text-neutral-200">{path}</span>

        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <button
                onClick={applyLines}
                className="rounded bg-indigo-500 px-2 py-0.5 text-xs text-white hover:bg-indigo-400"
              >
                {staged ? "Unstage" : "Stage"} {visualLineCount} line
                {visualLineCount === 1 ? "" : "s"}
              </button>
              {!staged && (
                <button
                  onClick={discardLines}
                  className="rounded bg-red-600/80 px-2 py-0.5 text-xs text-white hover:bg-red-500"
                  title="Discard selected lines"
                >
                  Discard {visualLineCount}
                </button>
              )}
            </>
          )}
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
            onClick={() => selectWipFile(null)}
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
          <SplitView
            diff={diff}
            lang={lang}
            selected={selected}
            onToggleLine={toggleLine}
            onToggleLines={toggleLines}
          />
        ) : (
          <UnifiedView
            diff={diff}
            lang={lang}
            selected={selected}
            onToggleLine={toggleLine}
            hunkActions={hunkActions}
          />
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
