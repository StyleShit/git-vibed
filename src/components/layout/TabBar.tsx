import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { unwrap } from "../../lib/ipc";

export function TabBar() {
  const tabs = useRepo((s) => s.tabs);
  const activeIdx = useRepo((s) => s.activeIdx);
  const setActive = useRepo((s) => s.setActive);
  const closeTab = useRepo((s) => s.closeTab);
  const openRepo = useRepo((s) => s.openRepo);
  const toast = useUI((s) => s.toast);

  async function openNew() {
    try {
      const p = await unwrap(window.gitApi.showOpenDialog());
      await openRepo(p);
    } catch (e) {
      if (e instanceof Error && e.message === "User cancelled") return;
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex h-9 shrink-0 items-stretch border-b border-neutral-800 bg-neutral-950"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Leave room on macOS for the traffic lights (hiddenInset). */}
      <div className="w-20 shrink-0" />
      <div
        className="flex flex-1 items-stretch overflow-x-auto"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {tabs.map((tab, idx) => {
          const isActive = idx === activeIdx;
          const folder = tab.path.split(/[\\/]/).pop() ?? tab.path;
          const branch = tab.status?.branch;
          return (
            <div
              key={tab.path}
              onClick={() => void setActive(idx)}
              onAuxClick={(e) => {
                // Middle-click to close — matches most browsers/terminals.
                if (e.button === 1) void closeTab(tab.path);
              }}
              title={tab.path}
              className={`group flex min-w-[140px] max-w-[240px] cursor-pointer items-center gap-2 border-r border-neutral-800 px-3 text-xs ${
                isActive
                  ? "border-t-2 border-t-indigo-500 bg-neutral-900 text-neutral-100"
                  : "text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-200"
              }`}
            >
              <span className="truncate">
                {folder}
                {branch && (
                  <span className="ml-1.5 text-[10px] text-neutral-500">· {branch}</span>
                )}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(tab.path);
                }}
                className="ml-auto rounded px-1 text-neutral-500 opacity-0 transition hover:bg-neutral-800 hover:text-neutral-100 group-hover:opacity-100"
                aria-label={`Close ${folder}`}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          onClick={openNew}
          className="flex items-center px-3 text-lg text-neutral-500 hover:bg-neutral-900 hover:text-neutral-100"
          title="Open another repository"
        >
          +
        </button>
      </div>
    </div>
  );
}
