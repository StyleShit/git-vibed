import { useEffect, useState } from "react";
import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";
import { CloseIcon, FolderIcon, PlusIcon } from "../ui/Icons";

// Landing screen shown on cold start (when no repos are open) and as an
// overlay when the user clicks the "+" in the tab bar. The overlay form
// lets the user pick from Recents without reaching for the OS folder
// picker every time.
export function Welcome({ overlay = false }: { overlay?: boolean }) {
  const open = useRepo((s) => s.openRepo);
  const toast = useUI((s) => s.toast);
  const setWelcomeOpen = useUI((s) => s.setWelcomeOpen);
  const [recent, setRecent] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void (async () => {
      const r = await window.gitApi.recentRepos();
      if (r.ok) setRecent(r.data);
    })();
  }, []);

  function close() {
    if (overlay) setWelcomeOpen(false);
  }

  // Close the overlay as soon as a repo is chosen so the loader in the
  // main panel is visible while `openRepo` finishes its initial refresh.
  // Running `open` fire-and-forget keeps the UI responsive on huge repos.
  function launchOpen(p: string) {
    close();
    void open(p).catch((e) =>
      toast("error", e instanceof Error ? e.message : String(e))
    );
  }

  async function browse() {
    try {
      const p = await unwrap(window.gitApi.showOpenDialog());
      launchOpen(p);
    } catch (e) {
      if (e instanceof Error && e.message === "User cancelled") return;
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  function openPath(p: string) {
    launchOpen(p);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0] as
      | (File & { path?: string })
      | undefined;
    if (file?.path) void openPath(file.path);
  }

  const filterLC = filter.trim().toLowerCase();
  const visibleRecent = filterLC
    ? recent.filter((p) => p.toLowerCase().includes(filterLC))
    : recent;

  // Rendering differs slightly between cold start (full-screen, drag
  // region for the macOS title bar) and overlay (centered card with a
  // dismissable backdrop).
  const container = overlay
    ? "gui-fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    : "flex h-screen w-screen items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 text-neutral-100";

  const containerStyle = overlay
    ? undefined
    : ({ WebkitAppRegion: "drag" } as React.CSSProperties);

  return (
    <div
      className={container}
      style={containerStyle}
      onClick={
        overlay ? (e) => e.target === e.currentTarget && close() : undefined
      }
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className={`gui-menu-in relative w-[520px] max-w-[92vw] overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/90 shadow-2xl ${
          dragOver ? "ring-2 ring-indigo-500" : ""
        }`}
      >
        {overlay && (
          <button
            onClick={close}
            title="Close"
            className="absolute right-3 top-3 rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <CloseIcon className="size-3.5" />
          </button>
        )}

        <div className="flex flex-col items-center gap-2 border-b border-neutral-800 px-8 pb-6 pt-10">
          <img
            src="./logo.png"
            alt="Git Vibed"
            className="size-12 rounded-xl"
          />
          <h1 className="text-xl font-semibold">Git Vibed</h1>
          <p className="text-center text-sm text-neutral-400">
            {overlay
              ? "Open another repository to work on."
              : "Open a git repository, or drop a folder anywhere in this window."}
          </p>
        </div>

        <div
          className={`flex flex-col gap-2 px-8 pt-5 ${
            recent.length > 0 ? "" : "pb-6"
          }`}
        >
          <button
            onClick={browse}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <FolderIcon className="size-4" />
            Open folder…
          </button>
          <button
            onClick={browse}
            className="flex items-center justify-center gap-2 rounded-lg border border-neutral-800 py-2 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <PlusIcon className="size-3.5" />
            Initialize a new repository
          </button>
        </div>

        {recent.length > 0 && (
          <div className="mt-5 flex flex-col gap-2 px-8 pb-6">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                Recent
              </span>
              {recent.length > 4 && (
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter"
                  className="w-32 rounded bg-neutral-800 px-2 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
                />
              )}
            </div>
            <ul className="max-h-[260px] space-y-0.5 overflow-y-auto">
              {visibleRecent.map((p) => {
                const name = p.split(/[\\/]/).pop() ?? p;
                return (
                  <li key={p}>
                    <button
                      onClick={() => openPath(p)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-800"
                      title={p}
                    >
                      <FolderIcon className="size-3.5 shrink-0 text-neutral-500" />
                      <span className="truncate text-neutral-100">{name}</span>
                      <span className="ml-auto min-w-0 max-w-[260px] truncate text-[10px] text-neutral-500">
                        {p}
                      </span>
                    </button>
                  </li>
                );
              })}
              {visibleRecent.length === 0 && (
                <li className="px-2 py-3 text-center text-xs text-neutral-500">
                  No matches
                </li>
              )}
            </ul>
          </div>
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-indigo-500/10 text-sm text-indigo-200">
            Drop folder to open
          </div>
        )}
      </div>
    </div>
  );
}
