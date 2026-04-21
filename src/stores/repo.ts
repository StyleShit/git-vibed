import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  Branch,
  Commit,
  PullRequest,
  RepoStatus,
  Remote,
  Stash,
  Tag,
  Worktree,
} from "@shared/types";
import { unwrap, maybe } from "../lib/ipc";
import { useUI } from "./ui";

// Per-tab data. Each open repository has its own slice, so switching tabs
// surfaces the other repo's state instantly without re-fetching.
export interface TabData {
  path: string;
  status: RepoStatus | null;
  branches: Branch[];
  commits: Commit[];
  // True once git log returned fewer than a full page — means there are no
  // older commits to paginate into. Prevents infinite scroll from firing
  // repeated no-op fetches at the bottom of the list.
  commitsExhausted: boolean;
  loadingMoreCommits: boolean;
  remotes: Remote[];
  prs: PullRequest[];
  stashes: Stash[];
  tags: Tag[];
  worktrees: Worktree[];
  ghAvailable: boolean;
  behindRemote: number;
  loading: boolean;
}

const LOG_PAGE_SIZE = 500;

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
  loadMoreCommits: (repoPath?: string) => Promise<void>;
  refreshRemotes: (repoPath?: string) => Promise<void>;
  refreshPRs: (repoPath?: string) => Promise<void>;
  refreshStashes: (repoPath?: string) => Promise<void>;
  refreshTags: (repoPath?: string) => Promise<void>;
  refreshWorktrees: (repoPath?: string) => Promise<void>;
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
    commitsExhausted: false,
    loadingMoreCommits: false,
    remotes: [],
    prs: [],
    stashes: [],
    tags: [],
    worktrees: [],
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
    // PR / commit selections are per-repo — carrying them across tabs
    // surfaces stale data (e.g. PR #42 doesn't exist in the other repo).
    // Reset any tab-scoped UI state on switch.
    const ui = useUI.getState();
    if (ui.selectedPR != null) ui.selectPR(null);
    if (ui.selectedCommit != null) ui.selectCommit(null);
    if (ui.selectedStash != null) ui.selectStash(null);
    if (ui.selectedCommitFile != null) ui.selectCommitFile(null);
    if (ui.selectedWipFile != null) ui.selectWipFile(null);
    if (ui.view === "pr-detail" || ui.view === "merge") ui.setView("graph");
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
      get().refreshStashes(path),
      get().refreshTags(path),
      get().refreshWorktrees(path),
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
    const commits = await maybe(
      window.gitApi.log({ all: opts?.all ?? true, limit: LOG_PAGE_SIZE }),
    );
    if (commits) {
      get().patchTab(path, {
        commits,
        commitsExhausted: commits.length < LOG_PAGE_SIZE,
        loadingMoreCommits: false,
      });
    }
  },

  loadMoreCommits: async (repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab || tab.commitsExhausted || tab.loadingMoreCommits) return;
    get().patchTab(path, { loadingMoreCommits: true });
    const next = await maybe(
      window.gitApi.log({
        all: true,
        limit: LOG_PAGE_SIZE,
        skip: tab.commits.length,
      }),
    );
    if (!next) {
      get().patchTab(path, { loadingMoreCommits: false });
      return;
    }
    // Dedupe by hash in case refreshLog races with loadMoreCommits and the
    // two batches overlap at a page boundary.
    const seen = new Set(tab.commits.map((c) => c.hash));
    const appended = next.filter((c) => !seen.has(c.hash));
    get().patchTab(path, {
      commits: [...tab.commits, ...appended],
      commitsExhausted: next.length < LOG_PAGE_SIZE,
      loadingMoreCommits: false,
    });
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
    const stateFilter = useUI.getState().prStateFilter;
    const prs = await maybe(window.ghApi.prList(stateFilter));
    get().patchTab(path, { prs: prs ?? [] });
  },

  refreshStashes: async (repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    const stashes = await maybe(window.gitApi.stashList());
    if (stashes) get().patchTab(path, { stashes });
  },

  refreshTags: async (repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    const tags = await maybe(window.gitApi.tags());
    if (tags) get().patchTab(path, { tags });
  },

  refreshWorktrees: async (repoPath) => {
    const path = repoPath ?? get().tabs[get().activeIdx]?.path;
    if (!path) return;
    const worktrees = await maybe(window.gitApi.worktreeList());
    if (worktrees) get().patchTab(path, { worktrees });
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
