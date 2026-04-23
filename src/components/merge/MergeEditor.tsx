import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { DiffEditor, type Monaco } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { useUI } from "../../stores/ui";
import { useActive, useRepo } from "../../stores/repo";
import { unwrap } from "../../lib/ipc";
import {
  threeWayMerge,
  acceptAll,
  regionsToString,
  conflictHeight,
  isFullyDecided,
  acceptedLines,
  setSideDecision,
  cycleLineDecision,
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
  const [base, setBase] = useState<string>("");
  const [result, setResult] = useState<string>("");
  const [regions, setRegions] = useState<ConflictRegion[]>([]);
  const [loading, setLoading] = useState(false);
  // For non-text-merge conflicts (delete/modify, both-added, …) we skip
  // the three-pane editor and show a decision prompt instead. null means
  // "either not loaded yet or this is a normal both-modified conflict".
  type ConflictKind =
    | "both-modified"
    | "deleted-by-us"
    | "deleted-by-them"
    | "both-added"
    | "ours-only"
    | "theirs-only"
    | "unknown";
  const [conflictKind, setConflictKind] = useState<ConflictKind | null>(null);
  // Rename target on the "deleting" side, when the apparent deletion is
  // actually a rename git's detection didn't fold together. Also carries
  // the renamed file's new content so the diff view can show it.
  const [renameInfo, setRenameInfo] = useState<{
    newPath: string;
    newContent: string;
  } | null>(null);

  // Bumped whenever a Monaco editor instance mounts. The decoration
  // effect watches this so it re-runs after the three panes
  // (re-)mount — necessary when the user navigates from a special
  // conflict (which tears the panes down) back to a both-modified
  // one, otherwise the effect fires against stale/disposed editor
  // refs and no red/green tint shows up.
  const [editorsEpoch, setEditorsEpoch] = useState(0);
  const oursEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const resultEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const theirsEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const resultDecosRef = useRef<string[]>([]);
  const oursDecosRef = useRef<string[]>([]);
  const theirsDecosRef = useRef<string[]>([]);
  const syncingRef = useRef(false);

  // The three-pane section is conditionally rendered. When we switch
  // to a special-conflict prompt the <Editor> instances unmount, but
  // the refs above are never auto-cleared — they keep pointing at the
  // disposed editors. Clear them here so the decoration effect can't
  // call deltaDecorations on a dead instance, and so the next mount's
  // onMount is writing to a clean slate.
  useEffect(() => {
    if (conflictKind !== null && conflictKind !== "both-modified") {
      oursEditorRef.current = null;
      resultEditorRef.current = null;
      theirsEditorRef.current = null;
      monacoRef.current = null;
      oursDecosRef.current = [];
      resultDecosRef.current = [];
      theirsDecosRef.current = [];
    }
  }, [conflictKind]);

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
    // Switching files rapidly can interleave responses from in-flight
    // requests — the older one lands last and overwrites the newer
    // file's state. Tag each effect run and only apply its results if
    // the tag is still current.
    let cancelled = false;
    void (async () => {
      try {
        // Do *all* the fetching before touching state. Setting
        // conflictKind / regions / ours / theirs piecemeal was causing
        // a visible flicker on file switch — the panel would briefly
        // drop back to the three-pane editor (the default when
        // conflictKind is null) between the reset and the first
        // successful setState. Computing the final values first and
        // batching a single atomic update avoids that entirely.
        const kindRes = await unwrap(window.gitApi.conflictKind(file));
        const [o, b, t] = await Promise.all([
          unwrap(window.gitApi.fileAtRef(":2", file)),
          unwrap(window.gitApi.fileAtRef(":1", file)),
          unwrap(window.gitApi.fileAtRef(":3", file)),
        ]);
        let nextRegions: ConflictRegion[] = [];
        let nextResult = "";
        let nextRename: { newPath: string; newContent: string } | null = null;
        if (kindRes === "both-modified") {
          nextRegions = threeWayMerge(o, b, t);
          nextResult = regionsToString(nextRegions);
        } else {
          // When one side looks "deleted", it may actually be a rename
          // git's detection didn't auto-fold. Ask git (with -M) whether
          // the "deleting" side in fact moved the file, and if so load
          // the content at the new path so the diff view can show the
          // real comparison ("your modifications at X" vs "renamed +
          // possibly modified at Y").
          const renameSide =
            kindRes === "deleted-by-them"
              ? "theirs"
              : kindRes === "deleted-by-us"
                ? "ours"
                : null;
          if (renameSide) {
            const newPath = await unwrap(
              window.gitApi.findRenameTarget(file, renameSide),
            );
            if (newPath) {
              const ref = renameSide === "theirs" ? "MERGE_HEAD" : "HEAD";
              const newContent = await unwrap(
                window.gitApi.fileAtRef(ref, newPath),
              );
              nextRename = { newPath, newContent };
            }
          }
        }
        if (cancelled) return;
        setConflictKind(kindRes);
        setOurs(o);
        setBase(b);
        setTheirs(t);
        setRegions(nextRegions);
        setResult(nextResult);
        setRenameInfo(nextRename);
      } catch (e) {
        if (!cancelled) toast("error", e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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

      // Conflict chunks read as "ours take vs theirs take": every
      // line on the ours side gets a red tint, every line on the
      // theirs side gets a green tint. Lines that also diverge from
      // base ("added" per the per-line diff) bump up to a stronger
      // shade so the user can still tell what actually changed.
      for (let i = 0; i < ours.length; i++) {
        const bg =
          oMarks[i] === "added"
            ? "merge-line-conflict-ours-strong-bg"
            : "merge-line-conflict-ours-bg";
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
          tMarks[i] === "added"
            ? "merge-line-conflict-theirs-strong-bg"
            : "merge-line-conflict-theirs-bg";
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
  }, [regions, result, lineMarks, editorsEpoch]);

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
      // Advance to the next conflicted file; clear when none left so the
      // stale editor for a now-resolved file doesn't linger.
      selectConflictFile(nextFile);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  function onClose() {
    // Drop every right-panel selection so BranchGraph falls through to
    // ChangesPanel (its default when nothing is selected). Landing the
    // user straight on the changes list is the natural next step —
    // they've resolved some files and now want to finish the commit.
    const ui = useUI.getState();
    selectConflictFile(null);
    ui.selectCommit(null);
    ui.selectStash(null);
    ui.selectCommitFile(null);
    ui.selectWipFile(null);
    ui.selectStashFile(null);
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

  // For non-text-merge conflicts, resolve by picking a side or deleting
  // the file outright. All three paths advance to the next conflict after
  // a successful resolution so the user can blow through a pile of them.
  async function resolveSpecial(
    choice: "keep-ours" | "keep-theirs" | "delete",
  ): Promise<void> {
    if (!file) return;
    try {
      const currentIdx = conflicted.findIndex((f) => f.path === file);
      const nextFile =
        currentIdx >= 0 && currentIdx + 1 < conflicted.length
          ? conflicted[currentIdx + 1].path
          : null;
      if (choice === "keep-ours") {
        await unwrap(window.gitApi.resolveWithSide(file, "ours"));
      } else if (choice === "keep-theirs") {
        await unwrap(window.gitApi.resolveWithSide(file, "theirs"));
      } else {
        await unwrap(window.gitApi.resolveWithDelete(file));
      }
      toast("success", "Resolved");
      await refreshAll();
      // Always move the selection off the resolved file — either onto the
      // next conflict or to nothing. Without this the resolution panel
      // keeps rendering for a path that's no longer in `conflicted`.
      selectConflictFile(nextFile);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  if (!file) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-neutral-500">
        Select a conflicted file on the left
      </div>
    );
  }

  const needsPrompt =
    conflictKind !== null && conflictKind !== "both-modified";
  // The "both modified" text-merge actions (All ours / All theirs /
  // Mark resolved) don't apply when the file is a delete/rename/both-
  // added. Swap them for the choice-panel actions so the toolbar
  // always reflects what the visible content actually supports.
  const specialActions = needsPrompt
    ? resolutionActionsFor({
        kind: conflictKind as SpecialConflictKind,
        file,
        oursBranch,
        theirsBranch,
        renameInfo,
      })
    : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <MergeToolbar
        unresolved={unresolved}
        onAcceptOurs={() => onAcceptAllSide("ours")}
        onAcceptTheirs={() => onAcceptAllSide("theirs")}
        onPrev={() => onNavigate("prev")}
        onNext={() => onNavigate("next")}
        onSave={saveAndMarkResolved}
        onClose={onClose}
        canSave={!loading && !needsPrompt}
        specialActions={specialActions}
        specialFile={needsPrompt ? file : null}
        onSpecialAction={resolveSpecial}
      />
      {needsPrompt ? (
        <ConflictChoicePanel
          kind={conflictKind as SpecialConflictKind}
          file={file}
          oursBranch={oursBranch}
          theirsBranch={theirsBranch}
          ours={ours}
          base={base}
          theirs={theirs}
          renameInfo={renameInfo}
          language={language}
        />
      ) : (
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
              // Stale IDs from the previous mount can't be applied to
              // this fresh editor instance — start the next
              // deltaDecorations call with an empty baseline.
              oursDecosRef.current = [];
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
              setEditorsEpoch((n) => n + 1);
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
              resultDecosRef.current = [];
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
              setEditorsEpoch((n) => n + 1);
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
              theirsDecosRef.current = [];
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
              setEditorsEpoch((n) => n + 1);
            }}
          />
        </div>
      </div>
      )}
    </div>
  );
}

// Prompt card for non-text-merge conflicts (delete/modify, both-added,
// stray stages). Text merges want the three-pane editor; these cases
// collapse to a small set of choices — take a side, or drop the file.
// A side-by-side diff (or single-file view) is embedded so the user
// can actually look at the content before deciding.
type SpecialConflictKind =
  | "deleted-by-us"
  | "deleted-by-them"
  | "both-added"
  | "ours-only"
  | "theirs-only"
  | "unknown";

export interface ResolutionAction {
  choice: "keep-ours" | "keep-theirs" | "delete";
  label: string;
  hint: string;
  danger?: boolean;
}

// Centralized action list so the merge toolbar and the choice panel
// can stay in sync. Defined at module scope so it's not re-derived on
// every render and so the toolbar can call it without going through
// the panel component.
function resolutionActionsFor(params: {
  kind: SpecialConflictKind;
  file: string;
  oursBranch: string;
  theirsBranch: string;
  renameInfo: { newPath: string; newContent: string } | null;
}): ResolutionAction[] {
  const { kind, file, oursBranch, theirsBranch, renameInfo } = params;
  const renamedOnTheirs = !!renameInfo && kind === "deleted-by-them";
  const renamedOnOurs = !!renameInfo && kind === "deleted-by-us";
  switch (kind) {
    case "deleted-by-us":
      if (renamedOnOurs && renameInfo) {
        return [
          {
            choice: "keep-theirs",
            label: `Keep the old path (${theirsBranch})`,
            hint: `Restore ${file} and drop the rename we made to ${renameInfo.newPath}.`,
          },
          {
            choice: "delete",
            label: `Accept the rename to ${renameInfo.newPath}`,
            hint: `Keep our rename; this path is removed and the renamed file stays.`,
            danger: true,
          },
        ];
      }
      return [
        {
          choice: "keep-theirs",
          label: `Keep the version from ${theirsBranch}`,
          hint: "Restore the file with the changes from the branch being merged in.",
        },
        {
          choice: "delete",
          label: "Keep the deletion",
          hint: "Discard the incoming changes and leave the file deleted.",
          danger: true,
        },
      ];
    case "deleted-by-them":
      if (renamedOnTheirs && renameInfo) {
        return [
          {
            choice: "keep-ours",
            label: `Keep our version at ${file}`,
            hint: `Block the rename; your changes stay at the original path.`,
          },
          {
            choice: "delete",
            label: `Accept the rename to ${renameInfo.newPath}`,
            hint: `Remove ${file}; the renamed version on ${theirsBranch} is used instead.`,
            danger: true,
          },
        ];
      }
      return [
        {
          choice: "keep-ours",
          label: `Keep our version (${oursBranch})`,
          hint: "Restore the file and drop the deletion from the incoming branch.",
        },
        {
          choice: "delete",
          label: "Accept the deletion",
          hint: "Remove the file as the incoming branch intended.",
          danger: true,
        },
      ];
    case "both-added":
      return [
        {
          choice: "keep-ours",
          label: `Take our version (${oursBranch})`,
          hint: "Replace the file with the contents from our branch.",
        },
        {
          choice: "keep-theirs",
          label: `Take their version (${theirsBranch})`,
          hint: "Replace the file with the contents from the branch being merged in.",
        },
      ];
    case "ours-only":
    case "theirs-only":
    case "unknown":
    default:
      return [
        {
          choice: "keep-ours",
          label: `Keep our version (${oursBranch})`,
          hint: "Use the content from our branch and mark resolved.",
        },
        {
          choice: "keep-theirs",
          label: `Keep their version (${theirsBranch})`,
          hint: "Use the content from the branch being merged in.",
        },
        {
          choice: "delete",
          label: "Remove the file",
          hint: "Delete the file entirely as the resolution.",
          danger: true,
        },
      ];
  }
}

function ConflictChoicePanel({
  kind,
  file,
  oursBranch,
  theirsBranch,
  ours,
  base,
  theirs,
  renameInfo,
  language,
}: {
  kind: SpecialConflictKind;
  file: string;
  oursBranch: string;
  theirsBranch: string;
  ours: string;
  base: string;
  theirs: string;
  renameInfo: { newPath: string; newContent: string } | null;
  language: string;
}) {
  const renamedOnTheirs = !!renameInfo && kind === "deleted-by-them";
  const renamedOnOurs = !!renameInfo && kind === "deleted-by-us";

  const summary = (() => {
    if (renamedOnTheirs && renameInfo) {
      return `This file was renamed to ${renameInfo.newPath} on ${theirsBranch}, and modified on ${oursBranch}.`;
    }
    if (renamedOnOurs && renameInfo) {
      return `This file was renamed to ${renameInfo.newPath} on ${oursBranch}, and modified on ${theirsBranch}.`;
    }
    switch (kind) {
      case "deleted-by-us":
        return `This file was deleted on ${oursBranch} but modified on ${theirsBranch}.`;
      case "deleted-by-them":
        return `This file was modified on ${oursBranch} but deleted on ${theirsBranch}.`;
      case "both-added":
        return `Both ${oursBranch} and ${theirsBranch} added this file independently with different contents.`;
      case "ours-only":
        return `Only ${oursBranch} has this file in the conflict — the base and ${theirsBranch} sides are missing.`;
      case "theirs-only":
        return `Only ${theirsBranch} has this file in the conflict — the base and ${oursBranch} sides are missing.`;
      case "unknown":
      default:
        return "This file is marked as conflicted but doesn't fit a standard three-way merge.";
    }
  })();

  // What the user really needs to see depends on which stages exist
  // and whether the "delete" was actually a rename:
  //   rename on theirs → our modifications at old path vs renamed file
  //                      content on theirs (so user sees what moved)
  //   rename on ours   → ours content at renamed path vs theirs at old
  //   deleted-by-us    → compare base vs theirs
  //   deleted-by-them  → compare base vs ours
  //   both-added       → compare ours vs theirs
  //   ours-only        → show ours
  //   theirs-only      → show theirs
  const compare = (() => {
    if (renamedOnTheirs && renameInfo) {
      return {
        mode: "diff" as const,
        originalLabel: `${oursBranch} — ${file}`,
        modifiedLabel: `${theirsBranch} — ${renameInfo.newPath}`,
        original: ours,
        modified: renameInfo.newContent,
      };
    }
    if (renamedOnOurs && renameInfo) {
      return {
        mode: "diff" as const,
        originalLabel: `${theirsBranch} — ${file}`,
        modifiedLabel: `${oursBranch} — ${renameInfo.newPath}`,
        original: theirs,
        modified: renameInfo.newContent,
      };
    }
    switch (kind) {
      case "deleted-by-us":
        return {
          mode: "diff" as const,
          originalLabel: `base — ${deriveFileLabel(file)} (before)`,
          modifiedLabel: `${theirsBranch} (modified)`,
          original: base,
          modified: theirs,
        };
      case "deleted-by-them":
        return {
          mode: "diff" as const,
          originalLabel: `base — ${deriveFileLabel(file)} (before)`,
          modifiedLabel: `${oursBranch} (modified)`,
          original: base,
          modified: ours,
        };
      case "both-added":
        return {
          mode: "diff" as const,
          originalLabel: `${oursBranch}`,
          modifiedLabel: `${theirsBranch}`,
          original: ours,
          modified: theirs,
        };
      case "ours-only":
        return { mode: "single" as const, label: oursBranch, content: ours };
      case "theirs-only":
        return { mode: "single" as const, label: theirsBranch, content: theirs };
      case "unknown":
      default:
        return ours || theirs
          ? {
              mode: "diff" as const,
              originalLabel: `${oursBranch}`,
              modifiedLabel: `${theirsBranch}`,
              original: ours,
              modified: theirs,
            }
          : { mode: "single" as const, label: "empty", content: "" };
    }
  })();

  const previewOptions: monacoNs.editor.IStandaloneEditorConstructionOptions = {
    readOnly: true,
    minimap: { enabled: false },
    fontSize: 12,
    scrollBeyondLastLine: false,
    renderWhitespace: "selection",
    lineNumbersMinChars: 3,
  };
  const diffPreviewOptions: monacoNs.editor.IStandaloneDiffEditorConstructionOptions = {
    ...previewOptions,
    renderSideBySide: true,
    originalEditable: false,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-neutral-800 bg-neutral-950">
      {/* Summary line only — the primary "How should we resolve …"
          question moved up into the toolbar to share the row with the
          resolution buttons. */}
      <div className="shrink-0 border-b border-neutral-800 bg-neutral-925 px-4 py-2 text-xs text-neutral-400">
        {summary}
      </div>

      {compare.mode === "diff" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid shrink-0 border-b border-neutral-800 bg-neutral-925 text-[11px] uppercase tracking-wider text-neutral-500" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="border-r border-neutral-800 px-3 py-1.5">{compare.originalLabel}</div>
            <div className="px-3 py-1.5">{compare.modifiedLabel}</div>
          </div>
          <div className="min-h-0 flex-1">
            <DiffEditor
              height="100%"
              language={language}
              original={compare.original}
              modified={compare.modified}
              options={diffPreviewOptions}
              theme={EDITOR_THEME}
            />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-neutral-800 bg-neutral-925 px-3 py-1.5 text-[11px] uppercase tracking-wider text-neutral-500">
            {compare.label}
          </div>
          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              language={language}
              value={compare.content}
              options={previewOptions}
              theme={EDITOR_THEME}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Basename of a repo-relative path — used in the compare-pane labels so
// they stay short even when the file lives deep in a tree.
function deriveFileLabel(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
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
  onAcceptOurs,
  onAcceptTheirs,
  onPrev,
  onNext,
  onSave,
  onClose,
  canSave,
  specialActions,
  specialFile,
  onSpecialAction,
}: {
  unresolved: number;
  onAcceptOurs: () => void;
  onAcceptTheirs: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSave: () => void;
  onClose: () => void;
  canSave: boolean;
  // When the current file is a delete/rename/both-added case, these
  // replace "All ours" / "All theirs" / "Mark resolved" — the text-
  // merge actions wouldn't do anything sensible there.
  specialActions: ResolutionAction[] | null;
  specialFile: string | null;
  onSpecialAction: (choice: "keep-ours" | "keep-theirs" | "delete") => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2">
      {specialActions ? (
        // Choice-panel mode: no text-merge actions on the left and no
        // prev/next nav (the current file has a single decision, not a
        // list of chunks to walk). Prompt question anchors the left
        // edge; resolution buttons sit on the right in the slot "Mark
        // resolved" normally occupies.
        <>
          <span className="ml-1 truncate pr-3 text-sm text-neutral-200">
            How should we resolve{" "}
            <span className="mono text-indigo-300">{specialFile ?? ""}</span>?
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {specialActions.map((a) => (
              <button
                key={a.choice}
                onClick={() => onSpecialAction(a.choice)}
                title={a.hint}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                  a.danger
                    ? "border-red-500/30 text-red-200 hover:bg-red-500/10"
                    : "border-neutral-700 text-neutral-100 hover:border-indigo-500/40 hover:bg-indigo-500/10"
                }`}
              >
                {a.label}
              </button>
            ))}
            <ToolbarIconButton onClick={onClose} title="Close merge editor">
              <CloseIcon className="size-4" />
            </ToolbarIconButton>
          </div>
        </>
      ) : (
        <>
          {/* Arrow direction reflects where the content is going: for
              "All ours" we're pulling from the left-hand Ours pane into
              the center Result pane, so the arrow points right. Same
              logic, mirrored, for "All theirs". */}
          <ToolbarButton
            onClick={onAcceptOurs}
            label="All ours"
            hint="accept every line on our side, drop every line on theirs"
            icon={<ArrowRightIcon className="size-4" />}
          />
          <ToolbarButton
            onClick={onAcceptTheirs}
            label="All theirs"
            hint="accept every line on their side, drop every line on ours"
            icon={<ArrowLeftIcon className="size-4" />}
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
        </>
      )}
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
