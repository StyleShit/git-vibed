import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "./components/layout/Sidebar";
import { MainPanel } from "./components/layout/MainPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { Toolbar } from "./components/layout/Toolbar";
import { Toasts } from "./components/layout/Toasts";
import { Welcome } from "./components/layout/Welcome";
import { TabBar } from "./components/layout/TabBar";
import { CommandPalette } from "./components/palette/CommandPalette";
import { ResizeHandle } from "./components/ui/ResizeHandle";
import { useRepo, useActiveTab } from "./stores/repo";
import { useSettings } from "./stores/settings";
import { useUI } from "./stores/ui";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { gitStatusOptions } from "./queries/gitApi";

export function App() {
  const tabs = useRepo((s) => s.tabs);
  const activeTab = useActiveTab();
  const theme = useSettings((s) => s.theme);
  const sidebarWidth = useSettings((s) => s.sidebarWidth);
  const setSidebarWidth = useSettings((s) => s.setSidebarWidth);
  const autoFetchIntervalMs = useSettings((s) => s.autoFetchIntervalMs);
  const toast = useUI((s) => s.toast);
  const welcomeOpen = useUI((s) => s.welcomeOpen);
  const view = useUI((s) => s.view);

  useKeyboardShortcuts();

  // Theme — dark by default but respects system + light.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const sync = () => root.classList.toggle("dark", mql.matches);
      sync();
      mql.addEventListener("change", sync);
      return () => mql.removeEventListener("change", sync);
    }
  }, [theme]);

  // Push the configured auto-fetch interval to the main process on mount and
  // whenever the dropdown in Settings changes it. The main process defaults
  // to 5 minutes, so this also rebinds existing sessions if the user picked
  // something else previously and the value was just hydrated from storage.
  useEffect(() => {
    void window.gitApi.setAutoFetchInterval(autoFetchIntervalMs);
  }, [autoFetchIntervalMs]);

  // Fetch lifecycle still lives here because backgroundFetching +
  // behindRemote are zustand UI state, not server-state. The
  // REPO_CHANGED + fetch-complete cache invalidations both run from
  // RepoEventBridge in src/queries/RepoEventBridge.tsx.
  useEffect(() => {
    const { setBehindRemote, setBackgroundFetching } = useRepo.getState();
    const MIN_SPINNER_MS = 700;
    const startedAt = new Map<string, number>();

    const offComplete = window.gitApi.onFetchComplete((e) => {
      setBehindRemote(e.repoPath, e.behind);
      const began = startedAt.get(e.repoPath);
      const elapsed = began != null ? Date.now() - began : MIN_SPINNER_MS;
      const remaining = Math.max(0, MIN_SPINNER_MS - elapsed);
      startedAt.delete(e.repoPath);
      if (remaining === 0) {
        setBackgroundFetching(e.repoPath, false);
      } else {
        window.setTimeout(
          () => setBackgroundFetching(e.repoPath, false),
          remaining,
        );
      }
      if (e.errors) toast("error", `Auto-fetch failed: ${e.errors}`);
    });
    const offStart = window.gitApi.onFetchStart((e) => {
      startedAt.set(e.repoPath, Date.now());
      setBackgroundFetching(e.repoPath, true);
    });
    return () => {
      offComplete();
      offStart();
    };
  }, [toast]);

  // Restore whatever the user had open when they last quit. If the session
  // file is empty (first run or everything was closed before quit), drop to
  // the Welcome screen rather than opening a random recent repo.
  useEffect(() => {
    if (tabs.length > 0) return;
    void (async () => {
      const res = await window.gitApi.sessionGet();
      if (!res.ok) return;
      const { openPaths, activePath } = res.data;
      if (openPaths.length === 0) return;
      for (const p of openPaths) {
        try {
          await useRepo.getState().openRepo(p);
        } catch {
          // Skip paths that no longer exist / aren't repos anymore.
        }
      }
      if (activePath) {
        const idx = useRepo
          .getState()
          .tabs.findIndex((t) => t.path === activePath);
        if (idx !== -1) await useRepo.getState().setActive(idx);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect the active tab in the window title.
  const activeBranch =
    useQuery(gitStatusOptions(activeTab?.path)).data?.branch ?? null;
  useEffect(() => {
    if (activeTab) {
      const folder = activeTab.path.split(/[\\/]/).pop();
      const branch = activeBranch ? ` — ${activeBranch}` : "";
      document.title = `${folder}${branch} · Git Vibed`;
    } else {
      document.title = "Git Vibed";
    }
  }, [activeTab?.path, activeBranch]);

  // Work-tree polling is now handled by the refetchInterval +
  // refetchOnWindowFocus options on gitStatusOptions itself.

  if (tabs.length === 0) {
    return (
      <>
        <Welcome />
        <Toasts />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100">
      <TabBar />
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {/* Hide the sidebar in the merge view — the ConflictList
            already occupies that visual slot and drives the flow,
            so rendering the repo sidebar next to it would just
            duplicate the "file list on the left" pattern. */}
        {view !== "merge" && (
          <>
            <div style={{ width: sidebarWidth }} className="shrink-0">
              <Sidebar />
            </div>
            <ResizeHandle
              onResize={(dx) => setSidebarWidth(sidebarWidth + dx)}
              side="right"
            />
          </>
        )}
        <MainPanel />
      </div>
      <StatusBar />
      <Toasts />
      <CommandPalette />
      {welcomeOpen && <Welcome overlay />}
    </div>
  );
}
