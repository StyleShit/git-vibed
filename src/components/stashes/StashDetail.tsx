import { useEffect, useState } from "react";
import { useActive, useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { maybe, unwrap } from "../../lib/ipc";
import { CloseIcon, StashIcon } from "../ui/Icons";

// Right-panel detail for a selected stash. Shows the stash metadata and a
// full diff of the stashed changes — clicking "Apply" / "Pop" / "Drop"
// runs the corresponding IPC and clears the selection.
export function StashDetail({ index }: { index: number }) {
  const stashes = useActive("stashes") ?? [];
  const stash = stashes.find((s) => s.index === index);
  const selectStash = useUI((s) => s.selectStash);
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const [diff, setDiff] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDiff("");
    if (!stash) return;
    void (async () => {
      const d = await maybe(window.gitApi.stashShow(index));
      setDiff(d ?? "");
    })();
  }, [index, stash]);

  if (!stash) {
    return (
      <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-925 p-3 text-sm text-neutral-500">
        Stash no longer exists.
      </aside>
    );
  }

  async function run(fn: () => Promise<unknown>, msg: string, close = false) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast("success", msg);
      await refreshAll();
      if (close) selectStash(null);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const subject = stash.message.replace(/^(?:WIP )?[Oo]n [^:]+:\s*(?:[0-9a-f]{7,}\s+)?/i, "");

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-925">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <StashIcon className="size-3.5" />
          <span className="mono text-neutral-200">{stash.ref}</span>
        </div>
        <button
          onClick={() => selectStash(null)}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          title="Close"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </div>

      <div className="border-b border-neutral-800 px-3 py-3">
        <div className="text-[15px] font-medium leading-snug text-neutral-100">
          {subject || stash.message}
        </div>
        {stash.branch && (
          <div className="mt-1 text-xs text-neutral-500">on {stash.branch}</div>
        )}
      </div>

      <div className="flex gap-1 border-b border-neutral-800 px-3 py-2 text-xs">
        <button
          disabled={busy}
          onClick={() =>
            run(() => unwrap(window.gitApi.stashApply(stash.index)), "Applied")
          }
          className="rounded bg-neutral-800 px-2 py-1 text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
        >
          Apply
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            // "Pop" = apply then drop; drop is what actually invalidates the
            // selection, so close only on success.
            if (busy) return;
            setBusy(true);
            try {
              if (stash.index === 0) {
                await unwrap(window.gitApi.stashPop());
              } else {
                await unwrap(window.gitApi.stashApply(stash.index));
                await unwrap(window.gitApi.stashDrop(stash.index));
              }
              toast("success", "Popped");
              await refreshAll();
              selectStash(null);
            } catch (e) {
              toast("error", e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
          className="rounded bg-indigo-500 px-2 py-1 text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          Pop
        </button>
        <div className="flex-1" />
        <button
          disabled={busy}
          onClick={() => {
            if (!confirm(`Drop ${stash.ref}? This can't be undone.`)) return;
            void run(
              () => unwrap(window.gitApi.stashDrop(stash.index)),
              "Dropped",
              true,
            );
          }}
          className="rounded px-2 py-1 text-red-400 hover:bg-neutral-800 disabled:opacity-50"
        >
          Drop
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {diff ? (
          <pre className="mono whitespace-pre p-3 text-[11px] leading-relaxed">
            {diff.split("\n").map((line, i) => (
              <div key={i} className={lineClass(line)}>
                {line || "\u00A0"}
              </div>
            ))}
          </pre>
        ) : (
          <div className="p-6 text-center text-xs text-neutral-500">Loading diff…</div>
        )}
      </div>
    </aside>
  );
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-neutral-400";
  if (line.startsWith("@@")) return "text-indigo-300";
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-300";
  if (line.startsWith("-")) return "bg-red-500/10 text-red-300";
  return "text-neutral-300";
}
