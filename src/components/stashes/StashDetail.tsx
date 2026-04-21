import { useEffect, useMemo, useState } from "react";
import { useActive, useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { maybe, unwrap } from "../../lib/ipc";
import { useSettings } from "../../stores/settings";
import { detectLanguage } from "../../lib/highlight";
import { SplitView, UnifiedView } from "../graph/DiffView";
import { CloseIcon, StashIcon, ChevronRightIcon } from "../ui/Icons";
import { useConfirm } from "../ui/Confirm";
import type { FileDiff } from "@shared/types";

// Stash detail rendered as a full-width main-view diff. Reuses the same
// UnifiedView / SplitView components that commit + WIP diffs use, so
// stashes inherit syntax highlighting and the hunk/split toggle for
// free. A left-side file list lets the user hop between the files
// covered by the stash, matching the commit-file browser.
export function StashDetail({ index }: { index: number }) {
  const stashes = useActive("stashes") ?? [];
  const stash = stashes.find((s) => s.index === index);
  const selectStash = useUI((s) => s.selectStash);
  const refreshAll = useRepo((s) => s.refreshAll);
  const toast = useUI((s) => s.toast);
  const confirmDialog = useConfirm();
  const viewMode = useSettings((s) => s.diffViewMode);
  const setViewMode = useSettings((s) => s.setDiffViewMode);
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFiles(null);
    setActivePath(null);
    if (!stash) return;
    void (async () => {
      const parsed = await maybe(window.gitApi.stashShowFiles(index));
      const list = parsed ?? [];
      setFiles(list);
      setActivePath(list[0]?.path ?? null);
    })();
  }, [index, stash]);

  const activeFile = useMemo(
    () => files?.find((f) => f.path === activePath) ?? null,
    [files, activePath],
  );
  const lang = useMemo(
    () => (activeFile ? detectLanguage(activeFile.path) : null),
    [activeFile],
  );

  if (!stash) {
    return (
      <div className="flex h-full w-full flex-col bg-neutral-950 p-3 text-sm text-neutral-500">
        Stash no longer exists.
      </div>
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

  const subject = stash.message.replace(
    /^(?:WIP )?[Oo]n [^:]+:\s*(?:[0-9a-f]{7,}\s+)?/i,
    "",
  );

  return (
    <div className="flex h-full w-full flex-col bg-neutral-950">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-925 px-2 text-xs">
        <StashIcon className="size-3.5 text-neutral-400" />
        <span className="mono text-neutral-200">{stash.ref}</span>
        {stash.branch && (
          <>
            <ChevronRightIcon className="size-3 text-neutral-600" />
            <span className="text-neutral-500">on {stash.branch}</span>
          </>
        )}
        {activeFile && (
          <>
            <ChevronRightIcon className="size-3 text-neutral-600" />
            <span className="mono truncate text-neutral-200">{activeFile.path}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            disabled={busy}
            onClick={() =>
              run(() => unwrap(window.gitApi.stashApply(stash.index)), "Applied")
            }
            className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            disabled={busy}
            onClick={async () => {
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
            className="rounded bg-indigo-500 px-2 py-0.5 text-xs text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            Pop
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Drop stash",
                message: `Drop ${stash.ref}?\nThis can't be undone.`,
                confirmLabel: "Drop",
                danger: true,
              });
              if (!ok) return;
              void run(
                () => unwrap(window.gitApi.stashDrop(stash.index)),
                "Dropped",
                true,
              );
            }}
            className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-neutral-800 disabled:opacity-50"
          >
            Drop
          </button>
          <div className="mx-1 flex rounded border border-neutral-800 p-0.5">
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
            onClick={() => selectStash(null)}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            title="Close stash (Esc)"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="border-b border-neutral-800 px-4 py-3">
        <div className="text-[15px] font-medium leading-snug text-neutral-100">
          {subject || stash.message}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* File list — only shown when the stash spans multiple files.
            Keeps the header breadcrumb as the sole UI on single-file
            stashes to avoid wasted space. */}
        {files && files.length > 1 && (
          <ul className="w-64 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-925 py-1 text-sm">
            {files.map((f) => {
              const isActive = f.path === activePath;
              return (
                <li key={f.path}>
                  <button
                    onClick={() => setActivePath(f.path)}
                    title={f.path}
                    className={`block w-full truncate px-3 py-1 text-left ${
                      isActive
                        ? "bg-indigo-500/15 text-neutral-100"
                        : "text-neutral-300 hover:bg-neutral-800"
                    }`}
                  >
                    {f.path}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {files === null ? (
            <div className="p-6 text-center text-xs text-neutral-500">
              Loading diff…
            </div>
          ) : files.length === 0 ? (
            <div className="p-6 text-center text-xs text-neutral-500">
              No changes in stash
            </div>
          ) : !activeFile ? (
            <div className="p-6 text-center text-xs text-neutral-500">
              Select a file
            </div>
          ) : activeFile.binary ? (
            <div className="p-6 text-center text-xs text-neutral-500">
              Binary file
            </div>
          ) : viewMode === "split" ? (
            <SplitView diff={activeFile} lang={lang} />
          ) : (
            <UnifiedView diff={activeFile} lang={lang} />
          )}
        </div>
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
