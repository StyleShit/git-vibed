import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { useUI } from "../../stores/ui";
import { useActive, useRepo } from "../../stores/repo";
import { unwrap } from "../../lib/ipc";
import {
  threeWayMerge,
  applySafe,
  acceptAll,
  regionsToString,
  conflictHeight,
  isFullyDecided,
  acceptedLines,
  setSideDecision,
  cycleLineDecision,
  magicWand,
  perLineDiff,
  type LineMark,
} from "../../lib/merge-engine";
import { monacoLanguageForPath } from "../../lib/monaco-language";
import { useConfirm } from "../ui/Confirm";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  MagicWandIcon,
} from "../ui/Icons";
import type { ConflictRegion } from "@shared/types";

const EDITOR_THEME = "git-vibed-dark";

interface ConflictAnchor {
  idx: number; // index into regions
  top: number; // y-pixel offset into the result editor viewport
  height: number; // pixel height of the chunk in the result pane
  oursDone: boolean; // every line on our side has a decision
  theirsDone: boolean; // every line on theirs side has a decision
}

// Three-pane merge editor, WebStorm-style.
// - Each conflict tracks per-line decisions on both sides; a chunk is
//   "resolved" only once every line on both sides is either accepted
//   (included in the result) or rejected (dropped).
// - The gutters between panes carry two small buttons per chunk per side:
//   » accept the whole side, ✕ drop the whole side. Click them in any
//   order so you can combine changes from both sides.
// - Fine-grained per-line resolution: click the glyph margin on any
//   conflict line in the ours/theirs panes to cycle that single line
//   (accept ↔ reject).
// - Lines added by each side relative to base get a soft green tint; base
//   lines that survived unchanged stay neutral.
// - Magic wand runs the safe rules then attempts a token-level diff3 on
//   what's left.
export function MergeEditor() {
  const file = useUI((s) => s.selectedConflictFile);
  const selectConflictFile = useUI((s) => s.selectConflictFile);
  const setView = useUI((s) => s.setView);
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);
  const confirmDialog = useConfirm();
  const status = useActive("status") ?? null;
  const oursBranch = status?.branch ?? "ours";
  const theirsBranch = status?.incomingBranch ?? "theirs";
  const conflicted = status?.conflicted ?? [];

  const [ours, setOurs] = useState<string>("");
  const [theirs, setTheirs] = useState<string>("");
  const [result, setResult] = useState<string>("");
  const [regions, setRegions] = useState<ConflictRegion[]>([]);
  const [loading, setLoading] = useState(false);

  const oursEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const resultEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const theirsEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const resultDecosRef = useRef<string[]>([]);
  const oursDecosRef = useRef<string[]>([]);
  const theirsDecosRef = useRef<string[]>([]);
  const syncingRef = useRef(false);

  // One set of anchors per gutter, each aligned to the pane it borders.
  // Ours gutter uses the ours editor's line positions; theirs gutter uses
  // the theirs editor's — otherwise a conflict whose content sits at
  // different line numbers across panes ends up with misaligned buttons.
  const [oursAnchors, setOursAnchors] = useState<ConflictAnchor[]>([]);
  const [theirsAnchors, setTheirsAnchors] = useState<ConflictAnchor[]>([]);
  const regionsRef = useRef<ConflictRegion[]>([]);
  regionsRef.current = regions;
  const resultRef = useRef<string>("");
  resultRef.current = result;
  const historyRef = useRef<Array<{ regions: ConflictRegion[]; result: string }>>([]);

  const language = useMemo(() => (file ? monacoLanguageForPath(file) : "plaintext"), [file]);

  // Per-line "added vs base" marks for each conflict's ours/theirs chunks.
  // Computed once per `regions` change and reused by the decoration pass.
  const lineMarks = useMemo(() => {
    const oursMarks: LineMark[][] = [];
    const theirsMarks: LineMark[][] = [];
    regions.forEach((r) => {
      if (r.kind !== "conflict") {
        oursMarks.push([]);
        theirsMarks.push([]);
        return;
      }
      const base = r.base ?? [];
      oursMarks.push(perLineDiff(base, r.ours ?? []));
      theirsMarks.push(perLineDiff(base, r.theirs ?? []));
    });
    return { oursMarks, theirsMarks };
  }, [regions]);

  useEffect(() => {
    if (!file) return;
    setLoading(true);
    historyRef.current = [];
    void (async () => {
      try {
        const [o, b, t] = await Promise.all([
          unwrap(window.gitApi.fileAtRef(":2", file)),
          unwrap(window.gitApi.fileAtRef(":1", file)),
          unwrap(window.gitApi.fileAtRef(":3", file)),
        ]);
        setOurs(o);
        setTheirs(t);
        const r = threeWayMerge(o, b, t);
        setRegions(r);
        setResult(regionsToString(r));
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [file, toast]);

  // Decorate each pane based on the current regions and decisions.
  //   ours/theirs: per-line background (green = added vs base) plus a
  //     glyph-margin state icon (pending/accept/reject).
  //   result: a red band across any lines that are still pending, so the
  //     "holes" the user needs to fill are obvious.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    const resultDecos: monacoNs.editor.IModelDeltaDecoration[] = [];
    const oursDecos: monacoNs.editor.IModelDeltaDecoration[] = [];
    const theirsDecos: monacoNs.editor.IModelDeltaDecoration[] = [];

    let resultLine = 1;
    let oursLine = 1;
    let theirsLine = 1;
    regions.forEach((r, idx) => {
      const resultCount = conflictHeight(r);
      if (r.kind === "ok") {
        // Color purely-additive ok regions green in the side that
        // actually introduced them: the ours pane for source="ours",
        // theirs pane for source="theirs", nothing for common content.
        if (r.source === "ours" && r.oursSpan > 0) {
          for (let i = 0; i < r.oursSpan; i++) {
            oursDecos.push({
              range: new monaco.Range(oursLine + i, 1, oursLine + i, 1),
              options: { isWholeLine: true, className: "merge-line-added-bg" },
            });
          }
        } else if (r.source === "theirs" && r.theirsSpan > 0) {
          for (let i = 0; i < r.theirsSpan; i++) {
            theirsDecos.push({
              range: new monaco.Range(theirsLine + i, 1, theirsLine + i, 1),
              options: { isWholeLine: true, className: "merge-line-added-bg" },
            });
          }
        }
        resultLine += resultCount;
        oursLine += r.oursSpan;
        theirsLine += r.theirsSpan;
        return;
      }

      const ours = r.ours ?? [];
      const theirs = r.theirs ?? [];
      const oDec = r.oursDecisions ?? [];
      const tDec = r.theirsDecisions ?? [];
      const oMarks = lineMarks.oursMarks[idx] ?? [];
      const tMarks = lineMarks.theirsMarks[idx] ?? [];

      for (let i = 0; i < ours.length; i++) {
        const bg =
          oMarks[i] === "added" ? "merge-line-added-bg" : "merge-line-neutral-bg";
        const glyph = glyphClassFor(oDec[i] ?? null);
        oursDecos.push({
          range: new monaco.Range(oursLine + i, 1, oursLine + i, 1),
          options: {
            isWholeLine: true,
            className: bg,
            glyphMarginClassName: glyph,
          },
        });
      }

      for (let i = 0; i < theirs.length; i++) {
        const bg =
          tMarks[i] === "added" ? "merge-line-added-bg" : "merge-line-neutral-bg";
        const glyph = glyphClassFor(tDec[i] ?? null);
        theirsDecos.push({
          range: new monaco.Range(theirsLine + i, 1, theirsLine + i, 1),
          options: {
            isWholeLine: true,
            className: bg,
            glyphMarginClassName: glyph,
          },
        });
      }

      // Result pane — highlight only the pending-placeholder rows red.
      // Accepted lines render normally so the user can see the shape of
      // their resolution in place.
      const accepted = acceptedLines(r).length;
      const placeholders = resultCount - accepted;
      if (placeholders > 0) {
        const start = resultLine + accepted;
        resultDecos.push({
          range: new monaco.Range(start, 1, start + placeholders - 1, 1),
          options: {
            isWholeLine: true,
            className: "merge-chunk-result-bg",
            linesDecorationsClassName: "merge-chunk-result-margin",
          },
        });
      }

      resultLine += resultCount;
      oursLine += r.oursSpan;
      theirsLine += r.theirsSpan;
    });

    if (resultEditorRef.current) {
      resultDecosRef.current = resultEditorRef.current.deltaDecorations(
        resultDecosRef.current,
        resultDecos,
      );
    }
    if (oursEditorRef.current) {
      oursDecosRef.current = oursEditorRef.current.deltaDecorations(
        oursDecosRef.current,
        oursDecos,
      );
    }
    if (theirsEditorRef.current) {
      theirsDecosRef.current = theirsEditorRef.current.deltaDecorations(
        theirsDecosRef.current,
        theirsDecos,
      );
    }
  }, [regions, result, lineMarks]);

  // Recompute per-gutter anchor positions. Each gutter is anchored to the
  // pane it borders: the ours gutter reads the ours editor's line Y, the
  // theirs gutter reads the theirs editor's — because the same conflict
  // can sit at a different line number in each pane whenever one side
  // added more/fewer lines than the other upstream.
  const recomputeAnchors = useCallback(() => {
    const oursEditor = oursEditorRef.current;
    const theirsEditor = theirsEditorRef.current;
    if (!oursEditor && !theirsEditor) return;
    const oursScroll = oursEditor?.getScrollTop() ?? 0;
    const theirsScroll = theirsEditor?.getScrollTop() ?? 0;

    const oursNext: ConflictAnchor[] = [];
    const theirsNext: ConflictAnchor[] = [];
    let oursLine = 1;
    let theirsLine = 1;
    regionsRef.current.forEach((r, idx) => {
      if (r.kind === "conflict" && !isFullyDecided(r)) {
        const os = r.oursDecisions ?? [];
        const ts = r.theirsDecisions ?? [];
        const oursDone = os.every((v) => v !== null);
        const theirsDone = ts.every((v) => v !== null);

        if (oursEditor && r.oursSpan > 0) {
          const top = oursEditor.getTopForLineNumber(oursLine) - oursScroll;
          const bottom =
            oursEditor.getTopForLineNumber(oursLine + r.oursSpan) - oursScroll;
          oursNext.push({ idx, top, height: bottom - top, oursDone, theirsDone });
        }
        if (theirsEditor && r.theirsSpan > 0) {
          const top = theirsEditor.getTopForLineNumber(theirsLine) - theirsScroll;
          const bottom =
            theirsEditor.getTopForLineNumber(theirsLine + r.theirsSpan) - theirsScroll;
          theirsNext.push({ idx, top, height: bottom - top, oursDone, theirsDone });
        }
      }
      oursLine += r.oursSpan;
      theirsLine += r.theirsSpan;
    });
    setOursAnchors(oursNext);
    setTheirsAnchors(theirsNext);
  }, []);

  useEffect(() => {
    recomputeAnchors();
  }, [regions, result, recomputeAnchors]);

  const unresolved = regions.filter(
    (r) => r.kind === "conflict" && !isFullyDecided(r),
  ).length;

  const recompute = useCallback((newRegions: ConflictRegion[]) => {
    historyRef.current.push({ regions: regionsRef.current, result: resultRef.current });
    if (historyRef.current.length > 50) historyRef.current.shift();
    setRegions(newRegions);
    setResult(regionsToString(newRegions));
  }, []);

  const onApplyNonConflicting = useCallback(() => {
    const before = regions.filter(
      (r) => r.kind === "conflict" && !isFullyDecided(r),
    ).length;
    const { resolved, conflictsRemaining } = applySafe(regions);
    recompute(resolved);
    const fixed = before - conflictsRemaining;
    if (fixed === 0) toast("info", "No non-conflicting changes to apply");
    else if (conflictsRemaining === 0) toast("success", `Resolved all ${fixed} chunk(s)`);
    else toast("success", `Resolved ${fixed}, ${conflictsRemaining} remaining`);
  }, [regions, recompute, toast]);

  const onMagicWand = useCallback(() => {
    const before = regions.filter(
      (r) => r.kind === "conflict" && !isFullyDecided(r),
    ).length;
    const { resolved, conflictsRemaining } = magicWand(regions);
    recompute(resolved);
    const fixed = before - conflictsRemaining;
    if (fixed === 0) toast("info", "Magic wand couldn't find anything to auto-resolve");
    else if (conflictsRemaining === 0) toast("success", `Magic wand resolved all ${fixed} chunk(s)`);
    else toast("success", `Resolved ${fixed}, ${conflictsRemaining} remaining`);
  }, [regions, recompute, toast]);

  const onAcceptAllSide = useCallback(
    (side: "ours" | "theirs") => recompute(acceptAll(regions, side)),
    [regions, recompute],
  );

  // Chunk-level: mark every line on one side of one chunk as accept/reject.
  const onChunkSideDecision = useCallback(
    (idx: number, side: "ours" | "theirs", accept: boolean) => {
      recompute(setSideDecision(regions, idx, side, accept));
    },
    [regions, recompute],
  );

  // Per-line: toggle a single line's decision.
  const onToggleLine = useCallback(
    (idx: number, side: "ours" | "theirs", lineIdx: number) => {
      recompute(cycleLineDecision(regions, idx, side, lineIdx));
    },
    [regions, recompute],
  );

  const onNavigate = useCallback(
    (dir: "prev" | "next") => {
      if (!resultEditorRef.current) return;
      const currentLine = resultEditorRef.current.getPosition()?.lineNumber ?? 1;
      const conflictLines: number[] = [];
      let lineNo = 1;
      for (const r of regions) {
        const count = conflictHeight(r);
        if (r.kind === "conflict" && !isFullyDecided(r)) conflictLines.push(lineNo);
        lineNo += count;
      }
      if (conflictLines.length === 0) return;
      const target =
        dir === "next"
          ? conflictLines.find((l) => l > currentLine) ?? conflictLines[0]
          : [...conflictLines].reverse().find((l) => l < currentLine) ??
            conflictLines[conflictLines.length - 1];
      resultEditorRef.current.revealLineInCenter(target);
      resultEditorRef.current.setPosition({ lineNumber: target, column: 1 });
      resultEditorRef.current.focus();
    },
    [regions],
  );

  async function saveAndMarkResolved() {
    if (!file) return;
    if (unresolved > 0) {
      const ok = await confirmDialog({
        title: "Mark resolved",
        message: `${unresolved} conflict${unresolved === 1 ? "" : "s"} remain — mark resolved anyway?`,
        confirmLabel: "Mark resolved",
      });
      if (!ok) return;
    }
    try {
      // Look up the next file before markResolved fires a refresh —
      // once the current file leaves `conflicted`, the index shifts.
      const currentIdx = conflicted.findIndex((f) => f.path === file);
      const nextFile = currentIdx >= 0 && currentIdx + 1 < conflicted.length
        ? conflicted[currentIdx + 1].path
        : null;

      await unwrap(window.gitApi.writeFile(file, result));
      await unwrap(window.gitApi.markResolved([file]));
      toast("success", "Marked resolved");
      await refreshAll();

      if (nextFile) {
        selectConflictFile(nextFile);
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  function onClose() {
    selectConflictFile(null);
    setView("graph");
  }

  const baseOptions = useMemo<monacoNs.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      renderWhitespace: "selection",
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
      padding: { top: 6, bottom: 6 },
    }),
    [],
  );

  // Ours/theirs need the glyph margin on so we can paint the decision
  // icons and catch clicks there. The result pane keeps it off — its
  // conflict highlight sits on the line body, not the gutter.
  const sideOptions = useMemo<monacoNs.editor.IStandaloneEditorConstructionOptions>(
    () => ({ ...baseOptions, readOnly: true, glyphMargin: true }),
    [baseOptions],
  );

  // Given a 1-indexed editor line in the ours or theirs pane, find which
  // conflict chunk it belongs to (if any) and the line offset within that
  // side's sub-array. Returns null for non-conflict lines.
  const mapSideLine = useCallback(
    (side: "ours" | "theirs", editorLine: number) => {
      let pos = 1;
      for (let i = 0; i < regionsRef.current.length; i++) {
        const r = regionsRef.current[i];
        const len = side === "ours" ? r.oursSpan : r.theirsSpan;
        if (r.kind === "conflict" && editorLine >= pos && editorLine < pos + len) {
          return { regionIdx: i, lineIdx: editorLine - pos };
        }
        pos += len;
      }
      return null;
    },
    [],
  );

  // Glyph-margin click in ours/theirs → cycle that line's decision.
  const onSideMouseDown = useCallback(
    (side: "ours" | "theirs") => (ev: monacoNs.editor.IEditorMouseEvent) => {
      const m = monacoRef.current;
      if (!m) return;
      if (ev.target.type !== m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = ev.target.position?.lineNumber;
      if (!line) return;
      const hit = mapSideLine(side, line);
      if (!hit) return;
      onToggleLine(hit.regionIdx, side, hit.lineIdx);
    },
    [mapSideLine, onToggleLine],
  );

  if (!file) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-neutral-500">
        Select a conflicted file on the left
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <MergeToolbar
        unresolved={unresolved}
        onMagicWand={onMagicWand}
        onApplyNonConflicting={onApplyNonConflicting}
        onAcceptOurs={() => onAcceptAllSide("ours")}
        onAcceptTheirs={() => onAcceptAllSide("theirs")}
        onPrev={() => onNavigate("prev")}
        onNext={() => onNavigate("next")}
        onSave={saveAndMarkResolved}
        onClose={onClose}
        canSave={!loading}
      />
      <div
        className="grid min-h-0 flex-1 border-t border-neutral-800"
        style={{ gridTemplateColumns: "1fr 36px 1fr 36px 1fr" }}
      >
        <PaneLabel label="Ours" sublabel={oursBranch} />
        <div className="border-b border-neutral-800 bg-neutral-925" />
        <PaneLabel label="Result" sublabel="editable" accent />
        <div className="border-b border-neutral-800 bg-neutral-925" />
        <PaneLabel label="Theirs" sublabel={theirsBranch} />
        <div className="min-w-0">
          <Editor
            height="100%"
            language={language}
            value={ours}
            options={sideOptions}
            theme={EDITOR_THEME}
            onMount={(e) => {
              oursEditorRef.current = e;
              e.onDidScrollChange((ev) => {
                if (syncingRef.current) return;
                syncingRef.current = true;
                resultEditorRef.current?.setScrollTop(ev.scrollTop);
                theirsEditorRef.current?.setScrollTop(ev.scrollTop);
                syncingRef.current = false;
                recomputeAnchors();
              });
              e.onMouseDown(onSideMouseDown("ours"));
              recomputeAnchors();
            }}
          />
        </div>
        <ConflictGutter
          anchors={oursAnchors}
          side="ours"
          onAccept={(idx) => onChunkSideDecision(idx, "ours", true)}
          onReject={(idx) => onChunkSideDecision(idx, "ours", false)}
        />
        <div className="min-w-0">
          <Editor
            height="100%"
            language={language}
            value={result}
            options={baseOptions}
            theme={EDITOR_THEME}
            onChange={(v) => setResult(v ?? "")}
            onMount={(e, m) => {
              resultEditorRef.current = e;
              monacoRef.current = m;
              e.onDidScrollChange((ev) => {
                if (syncingRef.current) return;
                syncingRef.current = true;
                oursEditorRef.current?.setScrollTop(ev.scrollTop);
                theirsEditorRef.current?.setScrollTop(ev.scrollTop);
                syncingRef.current = false;
                recomputeAnchors();
              });
              // Cmd/Ctrl+Z: first pop a chunk resolution if any, then
              // fall through to native Monaco undo for plain text edits.
              e.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyZ, () => {
                const prev = historyRef.current.pop();
                if (prev) {
                  setRegions(prev.regions);
                  setResult(prev.result);
                } else {
                  e.trigger("merge-editor", "undo", null);
                }
              });
              recomputeAnchors();
            }}
          />
        </div>
        <ConflictGutter
          anchors={theirsAnchors}
          side="theirs"
          onAccept={(idx) => onChunkSideDecision(idx, "theirs", true)}
          onReject={(idx) => onChunkSideDecision(idx, "theirs", false)}
        />
        <div className="min-w-0">
          <Editor
            height="100%"
            language={language}
            value={theirs}
            options={sideOptions}
            theme={EDITOR_THEME}
            onMount={(e) => {
              theirsEditorRef.current = e;
              e.onDidScrollChange((ev) => {
                if (syncingRef.current) return;
                syncingRef.current = true;
                oursEditorRef.current?.setScrollTop(ev.scrollTop);
                resultEditorRef.current?.setScrollTop(ev.scrollTop);
                syncingRef.current = false;
                recomputeAnchors();
              });
              e.onMouseDown(onSideMouseDown("theirs"));
              recomputeAnchors();
            }}
          />
        </div>
      </div>
    </div>
  );
}

// Map a per-line decision to the CSS class used for its glyph-margin icon.
function glyphClassFor(d: boolean | null): string {
  if (d === true) return "merge-glyph-accept";
  if (d === false) return "merge-glyph-reject";
  return "merge-glyph-pending";
}

// Thin vertical strip between editor panes. Each still-unresolved chunk
// gets two stacked buttons anchored at its y-position: accept (add this
// side's lines to the result) and reject (drop this side entirely). The
// active decision is highlighted so the user can see which sides still
// need action.
function ConflictGutter({
  anchors,
  side,
  onAccept,
  onReject,
}: {
  anchors: ConflictAnchor[];
  side: "ours" | "theirs";
  onAccept: (idx: number) => void;
  onReject: (idx: number) => void;
}) {
  return (
    <div className="relative overflow-hidden border-x border-neutral-800 bg-neutral-925">
      {anchors.map((a) => {
        const done = side === "ours" ? a.oursDone : a.theirsDone;
        return (
          <div
            key={a.idx}
            className="absolute left-1/2 flex -translate-x-1/2 flex-col gap-0.5"
            style={{ top: Math.max(0, a.top) }}
          >
            <button
              onClick={() => onAccept(a.idx)}
              title={side === "ours" ? "Accept ours" : "Accept theirs"}
              className="flex h-[18px] w-6 items-center justify-center rounded border border-emerald-600/40 bg-emerald-500/15 text-[11px] text-emerald-300 transition hover:bg-emerald-500/30"
            >
              {side === "ours" ? "»" : "«"}
            </button>
            <button
              onClick={() => onReject(a.idx)}
              title={side === "ours" ? "Drop ours" : "Drop theirs"}
              className={`flex h-[18px] w-6 items-center justify-center rounded border text-[11px] transition ${
                done
                  ? "border-neutral-700 bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                  : "border-red-600/40 bg-red-500/15 text-red-300 hover:bg-red-500/30"
              }`}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

function PaneLabel({
  label,
  sublabel,
  accent,
}: {
  label: string;
  sublabel: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-2 border-b border-neutral-800 px-3 py-1.5 ${
        accent ? "bg-neutral-900" : "bg-neutral-925"
      }`}
    >
      <span
        className={`text-[11px] font-semibold uppercase tracking-wider ${
          accent ? "text-indigo-300" : "text-neutral-300"
        }`}
      >
        {label}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{sublabel}</span>
    </div>
  );
}

function MergeToolbar({
  unresolved,
  onMagicWand,
  onApplyNonConflicting,
  onAcceptOurs,
  onAcceptTheirs,
  onPrev,
  onNext,
  onSave,
  onClose,
  canSave,
}: {
  unresolved: number;
  onMagicWand: () => void;
  onApplyNonConflicting: () => void;
  onAcceptOurs: () => void;
  onAcceptTheirs: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSave: () => void;
  onClose: () => void;
  canSave: boolean;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2">
      <ToolbarButton
        onClick={onMagicWand}
        label="Magic wand"
        hint="auto-resolve using token-level diff on top of the safe rules"
        icon={<MagicWandIcon className="size-4" />}
      />
      <ToolbarButton
        onClick={onApplyNonConflicting}
        label="Non-conflicting"
        hint="resolve only chunks where one side didn't change or both changed identically"
        icon={<CheckIcon className="size-4" />}
      />
      <div className="mx-2 h-6 w-px bg-neutral-800" />
      <ToolbarButton
        onClick={onAcceptOurs}
        label="All ours"
        hint="accept every line on our side, drop every line on theirs"
        icon={<ArrowLeftIcon className="size-4" />}
      />
      <ToolbarButton
        onClick={onAcceptTheirs}
        label="All theirs"
        hint="accept every line on their side, drop every line on ours"
        icon={<ArrowRightIcon className="size-4" />}
      />
      <div className="mx-2 h-6 w-px bg-neutral-800" />
      <ToolbarIconButton onClick={onPrev} title="Previous conflict">
        <ChevronUpIcon className="size-4" />
      </ToolbarIconButton>
      <ToolbarIconButton onClick={onNext} title="Next conflict">
        <ChevronDownIcon className="size-4" />
      </ToolbarIconButton>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-neutral-400">
          {unresolved === 0 ? (
            <span className="text-emerald-400">All resolved</span>
          ) : (
            <>
              <span className="font-medium text-neutral-200">{unresolved}</span> remaining
            </>
          )}
        </span>
        <button
          onClick={onSave}
          disabled={!canSave}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckIcon className="size-4" />
          Mark resolved
        </button>
        <ToolbarIconButton onClick={onClose} title="Close merge editor">
          <CloseIcon className="size-4" />
        </ToolbarIconButton>
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  label,
  hint,
  icon,
}: {
  onClick: () => void;
  label: string;
  hint?: string;
  icon: React.ReactNode;
}) {
  const title = hint ? `${label} — ${hint}` : label;
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex min-w-[56px] flex-col items-center rounded px-2 py-1 text-[10px] text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ToolbarIconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
    >
      {children}
    </button>
  );
}
