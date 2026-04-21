import { useEffect, useMemo, useState } from "react";
import { useUI } from "../../stores/ui";
import { useRepo } from "../../stores/repo";
import { unwrap } from "../../lib/ipc";
import { useSettings } from "../../stores/settings";
import { buildHunkPatch, buildLinePatch } from "../../lib/patch-builder";
import { detectLanguage, highlightLine } from "../../lib/highlight";
import type { FileDiff } from "@shared/types";
import { ChevronRightIcon } from "../ui/Icons";

// Uncommitted diff view — shown in the main panel when a file is selected
// in the Changes inspector. Supports hunk (unified) and side-by-side modes
// and lets the user stage/unstage/discard at the hunk or line level, just
// like the old ChangesView (reusing the same patch-builder plumbing).
const key = (h: number, l: number) => `${h}:${l}`;

export function WipFileDiff({ path, staged }: { path: string; staged: boolean }) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<{ h: number; l: number } | null>(null);
  const toast = useUI((s) => s.toast);
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2 text-xs">
        <button
          onClick={() => selectWipFile(null)}
          className="rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          ← Back
        </button>
        <ChevronRightIcon className="size-3 text-neutral-600" />
        <span className="text-neutral-400">{staged ? "staged" : "working"}</span>
        <ChevronRightIcon className="size-3 text-neutral-600" />
        <span className="mono text-neutral-200">{path}</span>

        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={applyLines}
              className="rounded bg-indigo-500 px-2 py-0.5 text-xs text-white hover:bg-indigo-400"
            >
              {staged ? "Unstage" : "Stage"} {selected.size} lines
            </button>
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
          <UnifiedView
            diff={diff}
            lang={lang}
            selected={selected}
            onToggleLine={toggleLine}
            onApplyHunk={applyHunk}
            staged={staged}
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

function UnifiedView({
  diff,
  lang,
  selected,
  onToggleLine,
  onApplyHunk,
  staged,
}: {
  diff: FileDiff;
  lang: string | null;
  selected: Set<string>;
  onToggleLine: (h: number, l: number, shift: boolean) => void;
  onApplyHunk: (h: number) => void;
  staged: boolean;
}) {
  return (
    <pre className="hljs mono whitespace-pre p-3 text-[12px] leading-relaxed">
      {diff.hunks.map((h, hi) => (
        <div key={hi} className="mb-3">
          <div className="flex items-center justify-between bg-neutral-900 px-2 py-0.5 text-indigo-300">
            <span>{h.header}</span>
            <button
              onClick={() => onApplyHunk(hi)}
              className="rounded px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
            >
              {staged ? "Unstage hunk" : "Stage hunk"}
            </button>
          </div>
          {h.lines.map((l, li) => {
            const k = `${hi}:${li}`;
            const sel = selected.has(k);
            const canSelect = l.type !== "context";
            return (
              <div
                key={li}
                onClick={(e) => canSelect && onToggleLine(hi, li, e.shiftKey)}
                className={`flex ${canSelect ? "cursor-pointer" : ""} ${
                  sel ? "outline outline-1 -outline-offset-1 outline-indigo-500/60" : ""
                } ${lineBgClass(l.type)}`}
              >
                <span className="mr-2 inline-block w-10 select-none text-right text-neutral-600">
                  {l.oldLineNo ?? ""}
                </span>
                <span className="mr-2 inline-block w-10 select-none text-right text-neutral-600">
                  {l.newLineNo ?? ""}
                </span>
                <span className="mr-1 inline-block w-3 text-neutral-500">
                  {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
                </span>
                <span
                  // hljs-generated HTML is trusted since we run it locally
                  // against our own diff output; no user-provided markup.
                  dangerouslySetInnerHTML={{
                    __html: l.content ? highlightLine(l.content, lang) : "&nbsp;",
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}
    </pre>
  );
}

function SplitView({ diff, lang }: { diff: FileDiff; lang: string | null }) {
  // Build left/right row pairs per hunk. Each "-" line becomes a left row;
  // each "+" line becomes a right row; context lines appear on both sides.
  // Deletions/additions align by index within the hunk — not perfect but
  // good enough for small diffs and matches GitKraken's side-by-side.
  const pairs = useMemo(() => {
    const out: Array<{
      hunkIdx: number;
      header?: string;
      left?: { ln: number | undefined; content: string; del: boolean };
      right?: { ln: number | undefined; content: string; add: boolean };
    }> = [];
    diff.hunks.forEach((h, hi) => {
      out.push({ hunkIdx: hi, header: h.header });
      const dels: typeof h.lines = [];
      const adds: typeof h.lines = [];
      const flush = () => {
        const max = Math.max(dels.length, adds.length);
        for (let i = 0; i < max; i++) {
          const d = dels[i];
          const a = adds[i];
          out.push({
            hunkIdx: hi,
            left: d ? { ln: d.oldLineNo, content: d.content, del: true } : undefined,
            right: a ? { ln: a.newLineNo, content: a.content, add: true } : undefined,
          });
        }
        dels.length = 0;
        adds.length = 0;
      };
      for (const l of h.lines) {
        if (l.type === "del") dels.push(l);
        else if (l.type === "add") adds.push(l);
        else {
          flush();
          out.push({
            hunkIdx: hi,
            left: { ln: l.oldLineNo, content: l.content, del: false },
            right: { ln: l.newLineNo, content: l.content, add: false },
          });
        }
      }
      flush();
    });
    return out;
  }, [diff]);

  return (
    <div className="hljs mono flex text-[12px] leading-relaxed">
      <div className="w-1/2 overflow-hidden">
        {pairs.map((p, i) =>
          p.header ? (
            <div key={i} className="bg-neutral-900 px-2 py-0.5 text-indigo-300">
              {p.header}
            </div>
          ) : (
            <div
              key={i}
              className={`flex whitespace-pre ${
                p.left?.del
                  ? "bg-red-500/15"
                  : p.left
                    ? ""
                    : "bg-neutral-900/40"
              }`}
            >
              <span className="mr-2 inline-block w-10 select-none px-1 text-right text-neutral-600">
                {p.left?.ln ?? ""}
              </span>
              <span
                className="pr-2"
                dangerouslySetInnerHTML={{
                  __html: p.left?.content
                    ? highlightLine(p.left.content, lang)
                    : "",
                }}
              />
            </div>
          ),
        )}
      </div>
      <div className="w-px bg-neutral-800" />
      <div className="w-1/2 overflow-hidden">
        {pairs.map((p, i) =>
          p.header ? (
            <div key={i} className="bg-neutral-900 px-2 py-0.5 text-indigo-300">
              {"\u00A0"}
            </div>
          ) : (
            <div
              key={i}
              className={`flex whitespace-pre ${
                p.right?.add
                  ? "bg-emerald-500/15"
                  : p.right
                    ? ""
                    : "bg-neutral-900/40"
              }`}
            >
              <span className="mr-2 inline-block w-10 select-none px-1 text-right text-neutral-600">
                {p.right?.ln ?? ""}
              </span>
              <span
                className="pr-2"
                dangerouslySetInnerHTML={{
                  __html: p.right?.content
                    ? highlightLine(p.right.content, lang)
                    : "",
                }}
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// Only the background tint — the foreground color comes from highlight.js
// now. Tinting add/del rows green/red keeps the diff readable while
// syntax colors still paint identifiers, keywords, etc.
function lineBgClass(t: "add" | "del" | "context"): string {
  if (t === "add") return "bg-emerald-500/15";
  if (t === "del") return "bg-red-500/15";
  return "";
}
