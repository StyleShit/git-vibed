import { useEffect, useMemo, useState } from "react";
import { useUI } from "../../stores/ui";
import { maybe } from "../../lib/ipc";
import { detectLanguage, highlightLine } from "../../lib/highlight";
import type { FileDiff } from "@shared/types";
import { ChevronRightIcon } from "../ui/Icons";

// Read-only diff for a file at a specific commit — shown in the center
// panel when a file is clicked inside CommitDetail. The back link returns
// the user to the commit graph without losing the selected commit.
export function CommitFileDiff({ hash, path }: { hash: string; path: string }) {
  const selectCommitFile = useUI((s) => s.selectCommitFile);
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
        <button
          onClick={() => selectCommitFile(null)}
          className="rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          ← Back
        </button>
        <ChevronRightIcon className="size-3 text-neutral-600" />
        <span className="mono text-neutral-400">{hash.slice(0, 7)}</span>
        <ChevronRightIcon className="size-3 text-neutral-600" />
        <span className="mono text-neutral-200">{path}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-neutral-950">
        {diff === null ? (
          <div className="p-6 text-center text-sm text-neutral-500">Loading diff…</div>
        ) : diff.binary ? (
          <div className="p-6 text-center text-sm text-neutral-500">Binary file</div>
        ) : diff.hunks.length === 0 ? (
          <div className="p-6 text-center text-sm text-neutral-500">No changes</div>
        ) : (
          <pre className="hljs mono whitespace-pre p-3 text-[12px] leading-relaxed">
            {diff.hunks.map((h, i) => (
              <div key={i} className="mb-3">
                <div className="bg-neutral-900 px-2 py-0.5 text-indigo-300">{h.header}</div>
                {h.lines.map((l, j) => (
                  <div key={j} className={`flex ${lineBgClass(l.type)}`}>
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
                      dangerouslySetInnerHTML={{
                        __html: l.content ? highlightLine(l.content, lang) : "&nbsp;",
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

function lineBgClass(t: "add" | "del" | "context"): string {
  if (t === "add") return "bg-emerald-500/15";
  if (t === "del") return "bg-red-500/15";
  return "";
}
