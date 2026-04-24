import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { unwrap, maybe } from "../lib/ipc";
import { useUI } from "./ui";

// Per-tab identity. Server-state (status / branches / commits / …) lives
// in TanStack Query under ["repo", path, …]; this store only carries
// what's intrinsic to the open tab plus two ephemeral UI flags driven by
// the fetch lifecycle.
export interface TabData {
  path: string;
  // Driven by onFetchComplete in App.tsx. Auto-fetch reports a fresher
  // behind count than `git status` does, so the StatusBar prefers it.
  behindRemote: number;
  // Driven by onFetchStart / onFetchComplete in App.tsx — toolbar shows
  // a subtle spinner while a background fetch tick is running.
  backgroundFetching: boolean;
}

interface RepoState {
  tabs: TabData[];
  activeIdx: number;
  openRepo: (path: string) => Promise<void>;
  closeTab: (path: string) => Promise<void>;
  setActive: (idx: number) => Promise<void>;
  setBehindRemote: (repoPath: string, v: number) => void;
  setBackgroundFetching: (repoPath: string, v: boolean) => void;
}

// Guards against concurrent opens of the same path (e.g. React 19 StrictMode
// double-firing a useEffect) — without this we'd push two tabs with the same
// key before either finished resolving.
const opensInFlight = new Set<string>();

function emptyTab(path: string): TabData {
  return {
    path,
    behindRemote: 0,
    backgroundFetching: false,
  };
}

function patchTab(
  state: RepoState,
  path: string,
  patch: Partial<TabData>,
): Partial<RepoState> {
  return {
    tabs: state.tabs.map((t) => (t.path === path ? { ...t, ...patch } : t)),
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
      set((s) => ({
        tabs: [...s.tabs, emptyTab(resolved)],
        activeIdx: s.tabs.length,
      }));
      queueSessionWrite(get());
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
    // Any tab-scoped view (pr-detail, merge, remotes) should fall back to
    // the history graph on switch. Settings is app-wide so we leave it alone.
    if (ui.view !== "graph" && ui.view !== "settings") ui.setView("graph");
    queueSessionWrite(get());
  },

  setBehindRemote: (path, behindRemote) =>
    set((s) => patchTab(s, path, { behindRemote })),
  setBackgroundFetching: (path, backgroundFetching) =>
    set((s) => patchTab(s, path, { backgroundFetching })),
}));

// Convenience selector — returns the active tab's identity. Server-state
// reads should use the queryOptions factories under src/queries/gitApi.ts.
export function useActiveTab(): TabData | null {
  return useRepo((s) => s.tabs[s.activeIdx] ?? null);
}

// Shallow-equality selector for reading multiple fields off the active tab.
// Mostly useful for grabbing path + a UI flag in one render.
export function useActiveTabShallow<T>(picker: (t: TabData | null) => T): T {
  return useRepo(useShallow((s) => picker(s.tabs[s.activeIdx] ?? null)));
}
