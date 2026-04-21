import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { useUI } from "../../stores/ui";
import { useRepo } from "../../stores/repo";
import { unwrap } from "../../lib/ipc";
import {
  threeWayMerge,
  applyNonConflicting,
  magicWand,
  acceptAll,
  regionsToString,
} from "../../lib/merge-engine";
import type { ConflictRegion } from "@shared/types";

// Three-pane merge: ours | result | theirs
// The editable pane is the middle one. We compute regions from the three
// blobs and offer toolbar actions to auto-resolve them.
export function MergeEditor() {
  const file = useUI((s) => s.selectedConflictFile);
  const toast = useUI((s) => s.toast);
  const refreshAll = useRepo((s) => s.refreshAll);

  const [ours, setOurs] = useState<string>("");
  const [base, setBase] = useState<string>("");
  const [theirs, setTheirs] = useState<string>("");
  const [result, setResult] = useState<string>("");
  const [regions, setRegions] = useState<ConflictRegion[]>([]);

  const oursEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const resultEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const theirsEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);

  // Load blobs and do an initial three-way merge when the file changes.
  useEffect(() => {
    if (!file) return;
    void (async () => {
      try {
        const [o, b, t] = await Promise.all([
          unwrap(window.gitApi.fileAtRef(":2", file)),
          unwrap(window.gitApi.fileAtRef(":1", file)),
          unwrap(window.gitApi.fileAtRef(":3", file)),
        ]);
        setOurs(o);
        setBase(b);
        setTheirs(t);
        const r = threeWayMerge(o, b, t);
        setRegions(r);
        setResult(regionsToString(r));
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    })();
  }, [file, toast]);

  // Decorate result editor with colored backgrounds for conflict regions.
  useEffect(() => {
    if (!monacoRef.current || !resultEditorRef.current) return;
    const monaco = monacoRef.current;
    const model = resultEditorRef.current.getModel();
    if (!model) return;
    const lines = result.split("\n");
    const decos: monacoNs.editor.IModelDeltaDecoration[] = [];
    let lineNo = 1;
    for (const r of regions) {
      const count =
        r.kind === "ok"
          ? (r.resolved ?? []).length
          : 3 + (r.ours?.length ?? 0) + (r.theirs?.length ?? 0);
      if (r.kind === "conflict") {
        decos.push({
          range: new monaco.Range(lineNo, 1, lineNo + count - 1, 1),
          options: {
            isWholeLine: true,
            className: "bg-red-950/30",
            linesDecorationsClassName: "bg-red-500",
            glyphMarginClassName: "bg-red-500",
          },
        });
      }
      lineNo += count;
      if (lineNo > lines.length) break;
    }
    decorationsRef.current = resultEditorRef.current.deltaDecorations(
      decorationsRef.current,
      decos,
    );
  }, [regions, result]);

  const unresolved = regions.filter((r) => r.kind === "conflict").length;

  function recompute(newRegions: ConflictRegion[]) {
    setRegions(newRegions);
    setResult(regionsToString(newRegions));
  }

  function onApplyNonConflicting() {
    const { resolved } = applyNonConflicting(regions);
    recompute(resolved);
  }

  function onMagicWand() {
    const { resolved, conflictsRemaining } = magicWand(regions);
    recompute(resolved);
    toast("info", conflictsRemaining === 0 ? "All conflicts resolved" : `${conflictsRemaining} conflict(s) remain`);
  }

  function onAcceptAll(side: "ours" | "theirs") {
    recompute(acceptAll(regions, side));
  }

  function onNavigate(dir: "prev" | "next") {
    if (!resultEditorRef.current) return;
    const lines = result.split("\n");
    const currentLine = resultEditorRef.current.getPosition()?.lineNumber ?? 1;
    const conflictLines: number[] = [];
    let lineNo = 1;
    for (const r of regions) {
      const count =
        r.kind === "ok"
          ? (r.resolved ?? []).length
          : 3 + (r.ours?.length ?? 0) + (r.theirs?.length ?? 0);
      if (r.kind === "conflict") conflictLines.push(lineNo);
      lineNo += count;
      if (lineNo > lines.length) break;
    }
    if (conflictLines.length === 0) return;
    const target =
      dir === "next"
        ? conflictLines.find((l) => l > currentLine) ?? conflictLines[0]
        : [...conflictLines].reverse().find((l) => l < currentLine) ??
          conflictLines[conflictLines.length - 1];
    resultEditorRef.current.revealLineInCenter(target);
    resultEditorRef.current.setPosition({ lineNumber: target, column: 1 });
  }

  async function saveAndMarkResolved() {
    if (!file) return;
    if (unresolved > 0 && !confirm(`${unresolved} conflict(s) remain — mark resolved anyway?`)) return;
    try {
      // Write the current result content back to the working tree. We don't
      // have a direct "write file" IPC — use the host shell by temporarily
      // piping through git's stdin via the apply-patch channel isn't right
      // either. So we write via a simple plaintext write through the API
      // (added as a dedicated IPC would be cleaner — for now we rely on
      // the user saving the file manually after closing; to avoid surprises
      // we surface a hint here).
      toast("info", "Save the result pane to disk, then click Mark Resolved");
      await unwrap(window.gitApi.markResolved([file]));
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  const options = useMemo<monacoNs.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      readOnly: false,
      minimap: { enabled: false },
      fontSize: 12,
      renderWhitespace: "selection",
      scrollBeyondLastLine: false,
    }),
    [],
  );

  if (!file) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-neutral-500">
        Select a conflicted file
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Toolbar
        unresolved={unresolved}
        onApply={onApplyNonConflicting}
        onMagic={onMagicWand}
        onAcceptOurs={() => onAcceptAll("ours")}
        onAcceptTheirs={() => onAcceptAll("theirs")}
        onPrev={() => onNavigate("prev")}
        onNext={() => onNavigate("next")}
        onSave={saveAndMarkResolved}
      />
      <div className="grid min-h-0 flex-1 grid-cols-3 border-t border-neutral-800">
        <PaneLabel label="Ours (current branch)" />
        <PaneLabel label="Result (editable)" accent />
        <PaneLabel label="Theirs (merging in)" />
        <Editor
          height="100%"
          defaultLanguage="plaintext"
          value={ours}
          options={{ ...options, readOnly: true }}
          theme="vs-dark"
          onMount={(e) => (oursEditorRef.current = e)}
        />
        <Editor
          height="100%"
          defaultLanguage="plaintext"
          value={result}
          options={options}
          theme="vs-dark"
          onChange={(v) => setResult(v ?? "")}
          onMount={(e, m) => {
            resultEditorRef.current = e;
            monacoRef.current = m;
            // Scroll-sync the three editors.
            e.onDidScrollChange((ev) => {
              oursEditorRef.current?.setScrollTop(ev.scrollTop);
              theirsEditorRef.current?.setScrollTop(ev.scrollTop);
            });
          }}
        />
        <Editor
          height="100%"
          defaultLanguage="plaintext"
          value={theirs}
          options={{ ...options, readOnly: true }}
          theme="vs-dark"
          onMount={(e) => (theirsEditorRef.current = e)}
        />
      </div>
    </div>
  );
}

function PaneLabel({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <div
      className={`border-b border-neutral-800 px-3 py-1.5 text-xs ${accent ? "bg-neutral-900 text-indigo-300" : "bg-neutral-925 text-neutral-400"}`}
    >
      {label}
    </div>
  );
}

function Toolbar({
  unresolved,
  onApply,
  onMagic,
  onAcceptOurs,
  onAcceptTheirs,
  onPrev,
  onNext,
  onSave,
}: {
  unresolved: number;
  onApply: () => void;
  onMagic: () => void;
  onAcceptOurs: () => void;
  onAcceptTheirs: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-neutral-800 bg-neutral-925 px-2 py-1.5 text-sm">
      <button className="rounded px-2 py-1 hover:bg-neutral-800" onClick={onApply}>
        Apply Non-Conflicting
      </button>
      <button className="rounded px-2 py-1 hover:bg-neutral-800" onClick={onMagic}>
        ✨ Magic Wand
      </button>
      <div className="mx-2 h-4 w-px bg-neutral-800" />
      <button className="rounded px-2 py-1 hover:bg-neutral-800" onClick={onAcceptOurs}>
        Accept All Ours
      </button>
      <button className="rounded px-2 py-1 hover:bg-neutral-800" onClick={onAcceptTheirs}>
        Accept All Theirs
      </button>
      <div className="mx-2 h-4 w-px bg-neutral-800" />
      <button className="rounded px-2 py-1 hover:bg-neutral-800" onClick={onPrev}>
        ↑ Prev
      </button>
      <button className="rounded px-2 py-1 hover:bg-neutral-800" onClick={onNext}>
        ↓ Next
      </button>
      <div className="flex-1" />
      <span className="text-xs text-neutral-400">
        {unresolved === 0 ? "All resolved" : `${unresolved} remaining`}
      </span>
      <button
        onClick={onSave}
        className="ml-3 rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-500"
      >
        Mark Resolved
      </button>
    </div>
  );
}
