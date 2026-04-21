import { useEffect, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { MainPanel } from "./components/layout/MainPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { Toolbar } from "./components/layout/Toolbar";
import { Toasts } from "./components/layout/Toasts";
import { Welcome } from "./components/layout/Welcome";
import { TabBar } from "./components/layout/TabBar";
import { useRepo, useActiveTab } from "./stores/repo";
import { useSettings } from "./stores/settings";
import { useUI } from "./stores/ui";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

export function App() {
  const tabs = useRepo((s) => s.tabs);
  const activeTab = useActiveTab();
  const theme = useSettings((s) => s.theme);
  const toast = useUI((s) => s.toast);

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
      setBehindRemote,
    } = useRepo.getState();
    const off1 = window.gitApi.onRepoChanged((e) => {
      const target = e.repoPath;
      if (e.type === "index" || e.type === "worktree") void refreshStatus(target);
      if (e.type === "head") {
        void refreshStatus(target);
        void refreshBranches(target);
        void refreshLog({ all: true }, target);
      }
      if (e.type === "refs") {
        void refreshBranches(target);
        void refreshLog({ all: true }, target);
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

  // Restore the most recent repo as a first tab on cold boot. Subsequent tabs
  // are user-driven (via the Welcome screen or the + button).
  useEffect(() => {
    if (tabs.length > 0) return;
    void (async () => {
      const recent = await window.gitApi.recentRepos();
      if (recent.ok && recent.data.length > 0) {
        try {
          await useRepo.getState().openRepo(recent.data[0]);
        } catch {
          // Ignore — user picks again via Welcome.
        }
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
        <Sidebar />
        <MainPanel />
      </div>
      <StatusBar />
      <Toasts />
    </div>
  );
}
