import { useEffect, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { MainPanel } from "./components/layout/MainPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { Toolbar } from "./components/layout/Toolbar";
import { Toasts } from "./components/layout/Toasts";
import { Welcome } from "./components/layout/Welcome";
import { useRepo } from "./stores/repo";
import { useSettings } from "./stores/settings";
import { useUI } from "./stores/ui";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

export function App() {
  const { repoPath, refreshAll, refreshStatus, refreshBranches, refreshLog, setBehindRemote } = useRepo();
  const theme = useSettings((s) => s.theme);
  const toast = useUI((s) => s.toast);

  useKeyboardShortcuts();

  // Wire theme — dark is the default but we respect system + light.
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

  // Forward IPC repo events into store refreshes. The watcher is debounced in
  // the main process so we won't flood the renderer here.
  useEffect(() => {
    const off1 = window.gitApi.onRepoChanged((e) => {
      if (e.type === "index" || e.type === "worktree") void refreshStatus();
      if (e.type === "head") {
        void refreshStatus();
        void refreshBranches();
        void refreshLog({ all: true });
      }
      if (e.type === "refs") {
        void refreshBranches();
        void refreshLog({ all: true });
      }
    });
    const off2 = window.gitApi.onFetchComplete((e) => {
      setBehindRemote(e.behind);
      if (e.errors) toast("error", `Auto-fetch failed: ${e.errors}`);
    });
    return () => {
      off1();
      off2();
    };
  }, [refreshStatus, refreshBranches, refreshLog, setBehindRemote, toast]);

  // Restore the last opened repo (from recent list) on first boot.
  useEffect(() => {
    if (repoPath) return;
    void (async () => {
      const recent = await window.gitApi.recentRepos();
      if (recent.ok && recent.data.length > 0) {
        try {
          await useRepo.getState().open(recent.data[0]);
        } catch {
          // Ignore — user can pick again via Welcome screen.
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the window title with current repo + branch.
  const { status } = useRepo();
  useEffect(() => {
    if (repoPath) {
      const folder = repoPath.split(/[\\/]/).pop();
      const branch = status?.branch ? ` — ${status.branch}` : "";
      document.title = `${folder}${branch} · Git GUI`;
    } else {
      document.title = "Git GUI";
    }
  }, [repoPath, status?.branch]);

  // Also refresh-all after a fetch completes to keep ahead/behind accurate.
  useEffect(() => {
    if (!repoPath) return;
    void refreshAll();
  }, [repoPath, refreshAll]);

  if (!repoPath) {
    return (
      <>
        <Welcome />
        <Toasts />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100">
      <DragRegion />
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

// A slim always-drag region for frameless windows (hiddenInset on macOS).
function DragRegion() {
  const [isMac] = useState(() => typeof navigator !== "undefined" && /Mac/.test(navigator.platform));
  if (!isMac) return null;
  return (
    <div
      className="h-6 w-full shrink-0 bg-neutral-950"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    />
  );
}
