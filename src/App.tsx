import { useEffect } from "react";
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

export function App() {
  const tabs = useRepo((s) => s.tabs);
  const activeTab = useActiveTab();
  const theme = useSettings((s) => s.theme);
  const sidebarWidth = useSettings((s) => s.sidebarWidth);
  const setSidebarWidth = useSettings((s) => s.setSidebarWidth);
  const toast = useUI((s) => s.toast);
  const welcomeOpen = useUI((s) => s.welcomeOpen);

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

  // Fan-in watcher events from the main process. Each event carries its
  // repoPath so we only refresh the matching tab rather than everything.
  useEffect(() => {
    const {
      refreshStatus,
      refreshBranches,
      refreshLog,
      refreshStashes,
      refreshTags,
      refreshWorktrees,
      setBehindRemote,
    } = useRepo.getState();
    const off1 = window.gitApi.onRepoChanged((e) => {
      const target = e.repoPath;
      if (e.type === "index" || e.type === "worktree") {
        void refreshStatus(target);
        void refreshStashes(target);
      }
      if (e.type === "head") {
        void refreshStatus(target);
        void refreshBranches(target);
        void refreshLog({ all: true }, target);
        void refreshWorktrees(target);
      }
      if (e.type === "refs") {
        void refreshBranches(target);
        void refreshLog({ all: true }, target);
        void refreshTags(target);
      }
    });
    const off2 = window.gitApi.onFetchComplete((e) => {
      setBehindRemote(e.repoPath, e.behind);
      if (e.errors) toast("error", `Auto-fetch failed: ${e.errors}`);
    });
    return () => {
      off1();
      off2();
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
        const idx = useRepo.getState().tabs.findIndex((t) => t.path === activePath);
        if (idx !== -1) await useRepo.getState().setActive(idx);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect the active tab in the window title.
  useEffect(() => {
    if (activeTab) {
      const folder = activeTab.path.split(/[\\/]/).pop();
      const branch = activeTab.status?.branch ? ` — ${activeTab.status.branch}` : "";
      document.title = `${folder}${branch} · Git GUI`;
    } else {
      document.title = "Git GUI";
    }
  }, [activeTab?.path, activeTab?.status?.branch]);

  // Work-tree edits don't touch .git, so the main-process watcher won't fire.
  // Poll `git status` on focus + periodically while the window is visible so
  // unstaged changes still show up without the crash-prone chokidar walk over
  // the whole working tree.
  useEffect(() => {
    if (!activeTab) return;
    const poll = () => {
      if (document.visibilityState === "visible") {
        void useRepo.getState().refreshStatus(activeTab.path);
      }
    };
    poll();
    const onFocus = () => poll();
    const onVis = () => poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    const interval = window.setInterval(poll, 5_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(interval);
    };
  }, [activeTab?.path]);

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
        <div style={{ width: sidebarWidth }} className="shrink-0">
          <Sidebar />
        </div>
        <ResizeHandle
          onResize={(dx) => setSidebarWidth(sidebarWidth + dx)}
          side="right"
        />
        <MainPanel />
      </div>
      <StatusBar />
      <Toasts />
      <CommandPalette />
      {welcomeOpen && <Welcome overlay />}
    </div>
  );
}
