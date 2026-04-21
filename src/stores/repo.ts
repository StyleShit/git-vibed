import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Branch, Commit, PullRequest, RepoStatus, Remote } from "@shared/types";
import { unwrap, maybe } from "../lib/ipc";

// Per-tab data. Each open repository has its own slice, so switching tabs
// surfaces the other repo's state instantly without re-fetching.
export interface TabData {
  path: string;
  status: RepoStatus | null;
  branches: Branch[];
  commits: Commit[];
  remotes: Remote[];
  prs: PullRequest[];
  ghAvailable: boolean;
  behindRemote: number;
  loading: boolean;
}

interface RepoState {
  tabs: TabData[];
  activeIdx: number;

  // Tab lifecycle
  openRepo: (path: string) => Promise<void>;
  closeTab: (path: string) => Promise<void>;
  setActive: (idx: number) => Promise<void>;

  // Per-tab data updaters (always operate on active tab unless specified).
  patchTab: (path: string, patch: Partial<TabData>) => void;
  refreshAll: (repoPath?: string) => Promise<void>;
  refreshStatus: (repoPath?: string) => Promise<void>;
  refreshBranches: (repoPath?: string) => Promise<void>;
  refreshLog: (opts?: { all?: boolean }, repoPath?: string) => Promise<void>;
  refreshRemotes: (repoPath?: string) => Promise<void>;
  refreshPRs: (repoPath?: string) => Promise<void>;
  setBehindRemote: (repoPath: string, v: number) => void;
}

// Guards against concurrent opens of the same path (e.g. React 19 StrictMode
// double-firing a useEffect) — without this we'd push two tabs with the same
// key before either finished resolving.
const opensInFlight = new Set<string>();

function emptyTab(path: string): TabData {
  return {
    path,
    status: null,
    branches: [],
    commits: [],
    remotes: [],
    prs: [],
    ghAvailable: false,
    behindRemote: 0,
    loading: true,
  };
}

// Mirror the current tab list + active pointer to main so next launch can
// restore exactly what the user had open. Debounced via microtask so a burst
// of mutations only writes once.
let sessionWriteQueued = false;
function queueSessionWrite(state: RepoState) {
  if (sessionWriteQueued) return;
  sessionWriteQueued = true;
  queueMicrotask(() => {
    sessionWriteQueued = false;
    const snap = {
      openPaths: state.tabs.map((t) => t.path),
      activePath: state.tabs[state.activeIdx]?.path ?? null,
    };
    void window.gitApi.sessionSet(snap);
  });
}

export const useRepo = create<RepoState>((set, get) => ({
  tabs: [],
  activeIdx: -1,

  openRepo: async (repoPath) => {
    if (opensInFlight.has(repoPath)) return;
    // Dedup: if this repo is already open, just switch to it.
    const existing = get().tabs.findIndex((t) => t.path === repoPath);
    if (existing !== -1) {
      await get().setActive(existing);
      return;
    }
    opensInFlight.add(repoPath);
    try {
      const resolved = await unwrap(window.gitApi.openRepo(repoPath));
      // Re-check after the IPC round trip: the path may have normalized into
      // something already in tabs, or a parallel call may have won the race.
      const postIdx = get().tabs.findIndex((t) => t.path === resolved);
      if (postIdx !== -1) {
        await get().setActive(postIdx);
        return;
      }
      const ghAvailable = (await maybe(window.ghApi.available())) ?? false;
      set((s) => ({
        tabs: [...s.tabs, { ...emptyTab(resolved), ghAvailable }],
        activeIdx: s.tabs.length,
      }));
      queueSessionWrite(get());
      await get().refreshAll(resolved);
      get().patchTab(resolved, { loading: false });
    } finally {
      opensInFlight.delete(repoPath);
    }
  },

  closeTab: async (path) => {
    const idx = get().tabs.findIndex((t) => t.path === path);
    if (idx === -1) return;
    await maybe(window.gitApi.closeRepo(path));
    set((s) => {
      const tabs = s.tabs.filter((_, i) => i !== idx);
      let activeIdx = s.activeIdx;
      if (tabs.length === 0) activeIdx = -1;
      else if (idx < s.activeIdx) activeIdx = s.activeIdx - 1;
      else if (idx === s.activeIdx) activeIdx = Math.min(idx, tabs.length - 1);
      return { tabs, activeIdx };
    });
    // Sync main's "active" pointer to match the new active tab.
    const next = get().tabs[get().activeIdx];
    if (next) await maybe(window.gitApi.setActiveRepo(next.path));
    queueSessionWrite(get());
  },

  setActive: async (idx) => {
    const tab = get().tabs[idx];
    if (!tab) return;
    // Wait for main to acknowledge the active switch before setting activeIdx
    // so subsequent IPC calls hit the right session.
    await maybe(window.gitApi.setActiveRepo(tab.path));
    set({ activeIdx: idx });
    queueSessionWrite(get());
  },

  patchTab: (path, patch) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, ...patch } : t)),
    }));
  },

  refreshAll: async (repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    await Promise.all([
      get().refreshStatus(path),
      get().refreshBranches(path),
      get().refreshLog({ all: true }, path),
      get().refreshRemotes(path),
      get().refreshPRs(path),
    ]);
  },

  refreshStatus: async (repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    const status = await maybe(window.gitApi.status());
    if (status) get().patchTab(path, { status });
  },

  refreshBranches: async (repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    const branches = await maybe(window.gitApi.branches());
    if (branches) get().patchTab(path, { branches });
  },

  refreshLog: async (opts, repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    const commits = await maybe(window.gitApi.log({ all: opts?.all ?? true, limit: 500 }));
    if (commits) get().patchTab(path, { commits });
  },

  refreshRemotes: async (repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    const remotes = await maybe(window.gitApi.remotes());
    if (remotes) get().patchTab(path, { remotes });
  },

  refreshPRs: async (repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab?.ghAvailable) {
      get().patchTab(path, { prs: [] });
      return;
    }
    const prs = await maybe(window.ghApi.prList("open"));
    get().patchTab(path, { prs: prs ?? [] });
  },

  setBehindRemote: (path, behindRemote) => get().patchTab(path, { behindRemote }),
}));

// Convenience selector — returns the active tab's data. Components that used
// to read from useRepo should now use this.
export function useActiveTab(): TabData | null {
  return useRepo((s) => s.tabs[s.activeIdx] ?? null);
}

// Shallow-equality selector for reading multiple fields off the active tab in
// one go without tripping React's identity checks.
export function useActiveTabShallow<T>(picker: (t: TabData | null) => T): T {
  return useRepo(useShallow((s) => picker(s.tabs[s.activeIdx] ?? null)));
}

// Grab a specific field off the active tab. Returns undefined when no tab is
// open, so callers can fall back to sensible defaults (empty arrays, null).
export function useActive<K extends keyof TabData>(key: K): TabData[K] | undefined {
  return useRepo((s) => s.tabs[s.activeIdx]?.[key]);
}
