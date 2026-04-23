import { useMemo } from "react";
import { highlightLine } from "../../lib/highlight";
import type { FileDiff } from "@shared/types";

// Shared unified + split diff renderers. Both used by WipFileDiff (with
// interactive staging) and CommitFileDiff (read-only). Selection and action
// callbacks are optional — when omitted the views render as plain read-only
// diffs without clickable affordances.

export interface HunkAction {
  label: string;
  onClick: (hunkIdx: number) => void;
  danger?: boolean;
  title?: string;
}

interface UnifiedProps {
  diff: FileDiff;
  lang: string | null;
  selected?: Set<string>;
  onToggleLine?: (h: number, l: number, shift: boolean) => void;
  hunkActions?: HunkAction[];
}

const key = (h: number, l: number) => `${h}:${l}`;

export function UnifiedView({
  diff,
  lang,
  selected,
  onToggleLine,
  hunkActions,
}: UnifiedProps) {
  return (
    <pre className="hljs mono whitespace-pre overflow-x-auto overflow-y-auto p-0 text-[12px] leading-relaxed">
      {diff.hunks.map((h, hi) => (
        <div key={hi}>
          <div className="flex items-center justify-between bg-neutral-900 px-2 py-0.5 text-indigo-300 sticky top-0">
            <span>{h.header}</span>
            {hunkActions && hunkActions.length > 0 && (
              <div className="flex items-center gap-1">
                {hunkActions.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => a.onClick(hi)}
                    title={a.title}
                    className={`rounded px-2 py-0.5 text-[11px] ${
                      a.danger
                        ? "text-red-300 hover:bg-red-500/20 hover:text-red-200"
                        : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {h.lines.map((l, li) => {
            const k = key(hi, li);
            const sel = selected?.has(k) ?? false;
            const canSelect = !!onToggleLine && l.type !== "context";
            return (
              <div
                key={li}
                onClick={(e) => canSelect && onToggleLine!(hi, li, e.shiftKey)}
                className={`flex ${canSelect ? "cursor-pointer" : ""} ${
                  sel ? "outline outline-1 -outline-offset-1 outline-indigo-500/60" : ""
                } ${lineBgClass(l.type)}`}
              >
                <span className="mr-2 inline-block w-10 select-none text-right text-neutral-600 flex-shrink-0">
                  {l.oldLineNo ?? ""}
                </span>
                <span className="mr-2 inline-block w-10 select-none text-right text-neutral-600 flex-shrink-0">
                  {l.newLineNo ?? ""}
                </span>
                <span className="mr-1 inline-block w-3 text-neutral-500 flex-shrink-0">
                  {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
                </span>
                <span
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

interface SplitProps {
  diff: FileDiff;
  lang: string | null;
  // Optional selection + toggle enables line-level staging in the split
  // view. Clicking a delete line on the left OR an add line on the right
  // toggles that line's selection; context lines stay non-interactive.
  selected?: Set<string>;
  onToggleLine?: (h: number, l: number, shift: boolean) => void;
  // Atomic toggle for modify rows where a del and an add sit on the same
  // row — clicking either side toggles both in one action.
  onToggleLines?: (lines: Array<{ h: number; l: number }>, shift: boolean) => void;
}

// Build left/right row pairs per hunk. Each "-" line becomes a left row;
// each "+" line becomes a right row; context lines appear on both sides.
// We also track the original (hunk, lineIndex) per side so callers can map
// a click back to the hunk line and toggle selection for staging.
export function SplitView({
  diff,
  lang,
  selected,
  onToggleLine,
  onToggleLines,
}: SplitProps) {
  const pairs = useMemo(() => {
    interface Side {
      ln: number | undefined;
      content: string;
      del?: boolean;
      add?: boolean;
      hunkIdx: number;
      lineIdx: number;
    }
    const out: Array<{
      hunkIdx: number;
      header?: string;
      left?: Side;
      right?: Side;
    }> = [];
    diff.hunks.forEach((h, hi) => {
      out.push({ hunkIdx: hi, header: h.header });
      // Align dels and adds that sit back-to-back. Flushing on a context
      // line preserves the visual pairing a user expects.
      const dels: Array<{ line: (typeof h.lines)[number]; idx: number }> = [];
      const adds: Array<{ line: (typeof h.lines)[number]; idx: number }> = [];
      const flush = () => {
        const max = Math.max(dels.length, adds.length);
        for (let i = 0; i < max; i++) {
          const d = dels[i];
          const a = adds[i];
          out.push({
            hunkIdx: hi,
            left: d
              ? { ln: d.line.oldLineNo, content: d.line.content, del: true, hunkIdx: hi, lineIdx: d.idx }
              : undefined,
            right: a
              ? { ln: a.line.newLineNo, content: a.line.content, add: true, hunkIdx: hi, lineIdx: a.idx }
              : undefined,
          });
        }
        dels.length = 0;
        adds.length = 0;
      };
      h.lines.forEach((l, li) => {
        if (l.type === "del") dels.push({ line: l, idx: li });
        else if (l.type === "add") adds.push({ line: l, idx: li });
        else {
          flush();
          out.push({
            hunkIdx: hi,
            left: {
              ln: l.oldLineNo,
              content: l.content,
              hunkIdx: hi,
              lineIdx: li,
            },
            right: {
              ln: l.newLineNo,
              content: l.content,
              hunkIdx: hi,
              lineIdx: li,
            },
          });
        }
      });
      flush();
    });
    return out;
  }, [diff]);

  const interactive = !!onToggleLine;

  // Resolve click on either side of a row: atomic toggle covers both
  // sides when the row pairs a del with an add, so the selection stays
  // consistent between the two halves.
  const clickRow = (
    p: (typeof pairs)[number],
    e: React.MouseEvent,
  ): void => {
    if (!interactive) return;
    const both = p.left?.del && p.right?.add;
    if (both && onToggleLines) {
      onToggleLines(
        [
          { h: p.left!.hunkIdx, l: p.left!.lineIdx },
          { h: p.right!.hunkIdx, l: p.right!.lineIdx },
        ],
        e.shiftKey,
      );
      return;
    }
    // Single-sided rows (pure deletion or pure insertion) — toggle the
    // selectable side that exists.
    const target = p.left?.del ? p.left : p.right?.add ? p.right : null;
    if (target) onToggleLine!(target.hunkIdx, target.lineIdx, e.shiftKey);
  };

  return (
    <div className="hljs mono flex p-0 text-[12px] leading-relaxed">
      <div className="w-1/2 overflow-x-auto overflow-y-hidden">
        {pairs.map((p, i) =>
          p.header ? (
            <div key={i} className="bg-neutral-900 px-2 py-0.5 text-indigo-300">
              {p.header}
            </div>
          ) : (
            <SplitLine
              key={i}
              side="left"
              ln={p.left?.ln}
              content={p.left?.content ?? ""}
              lang={lang}
              kind={p.left?.del ? "del" : p.left ? "context" : "empty"}
              selectable={!!(p.left?.del || p.right?.add) && interactive}
              selected={
                p.left?.del && selected
                  ? selected.has(key(p.left.hunkIdx, p.left.lineIdx))
                  : false
              }
              onClick={(e) => clickRow(p, e)}
            />
          ),
        )}
      </div>
      <div className="w-px bg-neutral-800" />
      <div className="w-1/2 overflow-x-auto overflow-y-hidden">
        {pairs.map((p, i) =>
          p.header ? (
            <div key={i} className="bg-neutral-900 px-2 py-0.5 text-indigo-300">
              {"\u00A0"}
            </div>
          ) : (
            <SplitLine
              key={i}
              side="right"
              ln={p.right?.ln}
              content={p.right?.content ?? ""}
              lang={lang}
              kind={p.right?.add ? "add" : p.right ? "context" : "empty"}
              selectable={!!(p.left?.del || p.right?.add) && interactive}
              selected={
                p.right?.add && selected
                  ? selected.has(key(p.right.hunkIdx, p.right.lineIdx))
                  : false
              }
              onClick={(e) => clickRow(p, e)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function SplitLine({
  ln,
  content,
  lang,
  kind,
  selectable,
  selected,
  onClick,
}: {
  side: "left" | "right";
  ln: number | undefined;
  content: string;
  lang: string | null;
  kind: "add" | "del" | "context" | "empty";
  selectable: boolean;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const bg =
    kind === "del"
      ? "bg-red-500/15"
      : kind === "add"
        ? "bg-emerald-500/15"
        : kind === "empty"
          ? "bg-neutral-900/40"
          : "";
  return (
    <div
      onClick={onClick}
      className={`flex whitespace-pre ${bg} ${selectable ? "cursor-pointer" : ""} ${
        selected ? "outline outline-1 -outline-offset-1 outline-indigo-500/60" : ""
      }`}
    >
      <span className="mr-2 inline-block w-10 select-none px-1 text-right text-neutral-600 flex-shrink-0">
        {ln ?? ""}
      </span>
      <span
        className="pr-2"
        dangerouslySetInnerHTML={{
          __html: content ? highlightLine(content, lang) : "",
        }}
      />
    </div>
  );
}

function lineBgClass(t: "add" | "del" | "context"): string {
  if (t === "add") return "bg-emerald-500/15";
  if (t === "del") return "bg-red-500/15";
  return "";
}
