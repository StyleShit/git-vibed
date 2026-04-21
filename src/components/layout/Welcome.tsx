import { useEffect, useState } from "react";
import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";

export function Welcome() {
  const open = useRepo((s) => s.open);
  const toast = useUI((s) => s.toast);
  const [recent, setRecent] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await window.gitApi.recentRepos();
      if (r.ok) setRecent(r.data);
    })();
  }, []);

  async function browse() {
    try {
      const p = await unwrap(window.gitApi.showOpenDialog());
      await open(p);
    } catch (e) {
      if (e instanceof Error && e.message === "User cancelled") return;
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function openPath(p: string) {
    try {
      await open(p);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    // The File API in Electron's renderer exposes .path on File when dropped
    // from Finder/Explorer. We rely on that rather than shimming something.
    const file = e.dataTransfer.files[0] as (File & { path?: string }) | undefined;
    if (file?.path) void openPath(file.path);
  }

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-100"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div
        className={`w-[480px] rounded-xl border border-neutral-800 bg-neutral-900 p-8 shadow-2xl transition ${
          dragOver ? "ring-2 ring-indigo-500" : ""
        }`}
      >
        <h1 className="mb-2 text-2xl font-semibold">Git GUI</h1>
        <p className="mb-6 text-sm text-neutral-400">
          Open a git repository to get started. You can also drop a folder here.
        </p>
        <button
          onClick={browse}
          className="w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          Open Folder…
        </button>
        {recent.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Recent</div>
            <ul className="space-y-1">
              {recent.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => openPath(p)}
                    className="w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-800"
                    title={p}
                  >
                    {p.split(/[\\/]/).pop()}{" "}
                    <span className="text-xs text-neutral-500">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
