import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";

// -webkit-app-region doesn't inherit in all cases, so we set it explicitly on
// every cell. On macOS (hiddenInset title-bar) the OS handles double-click to
// zoom when it sees a drag region under the pointer — so every gap the user
// can reach needs to be a drag region.
const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function TabBar() {
  const tabs = useRepo((s) => s.tabs);
  const activeIdx = useRepo((s) => s.activeIdx);
  const setActive = useRepo((s) => s.setActive);
  const closeTab = useRepo((s) => s.closeTab);
  const setWelcomeOpen = useUI((s) => s.setWelcomeOpen);
  const status = useRepo((s) => s.activeTab?.status);
  const hasConflicts = (status?.conflicted.length ?? 0) > 0;
  const isMac =
    typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? "");

  // "+" opens the Welcome overlay rather than the OS folder picker —
  // that way the user can jump to a recent repo in one click instead
  // of re-navigating the file system every time.
  function openNew() {
    setWelcomeOpen(true);
  }

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex h-9 shrink-0 items-stretch border-b border-neutral-800 bg-neutral-950"
      style={DRAG}
    >
      {/* Reserve space for macOS traffic lights. Explicitly draggable so
          double-clicking this area zooms the window. */}
      {isMac && <div className="w-20 shrink-0" style={DRAG} />}

      {/* Brand mark in the title-bar area — visible on every platform since
          the OS-drawn title bar is either hidden (macOS hiddenInset) or shows
          a tiny, pixelated icon (Windows/Linux). */}
      <div
        className="flex shrink-0 items-center px-2"
        style={DRAG}
        title="Git Vibed"
      >
        <img src="./logo.png" alt="Git Vibed" className="size-5 rounded" />
      </div>

      {tabs.map((tab, idx) => {
        const isActive = idx === activeIdx;
        const folder = tab.path.split(/[\\/]/).pop() ?? tab.path;
        const branch = tab.status?.branch;
        const tabHasConflicts = (tab.status?.conflicted.length ?? 0) > 0;
        return (
          <div
            key={tab.path}
            onClick={() => void setActive(idx)}
            onAuxClick={(e) => {
              if (e.button === 1 && !hasConflicts) void closeTab(tab.path);
            }}
            title={tab.path}
            style={NO_DRAG}
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
                if (!tabHasConflicts) void closeTab(tab.path);
              }}
              disabled={tabHasConflicts}
              title={tabHasConflicts ? "Cannot close tab with unresolved conflicts" : undefined}
              className={`ml-auto rounded px-1 opacity-0 transition group-hover:opacity-100 ${
                tabHasConflicts
                  ? "cursor-not-allowed text-neutral-600"
                  : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
              }`}
              aria-label={`Close ${folder}`}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        onClick={openNew}
        style={NO_DRAG}
        className="flex items-center border-r border-neutral-800 px-3 text-lg text-neutral-500 hover:bg-neutral-900 hover:text-neutral-100"
        title="Open another repository"
      >
        +
      </button>
      {/* Spacer to fill the rest of the bar — draggable so the user always
          has a big target for dragging the window and double-click-to-zoom. */}
      <div className="flex-1" style={DRAG} />
    </div>
  );
}
