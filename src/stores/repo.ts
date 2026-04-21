import { create } from "zustand";
import type { Branch, Commit, PullRequest, RepoStatus, Remote } from "@shared/types";
import { unwrap, maybe } from "../lib/ipc";

interface RepoState {
  repoPath: string | null;
  loading: boolean;
  status: RepoStatus | null;
  branches: Branch[];
  commits: Commit[];
  remotes: Remote[];
  prs: PullRequest[];
  ghAvailable: boolean;
  behindRemote: number;

  open: (path: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshBranches: () => Promise<void>;
  refreshLog: (opts?: { all?: boolean }) => Promise<void>;
  refreshRemotes: () => Promise<void>;
  refreshPRs: () => Promise<void>;
  setGhAvailable: (v: boolean) => void;
  setBehindRemote: (v: number) => void;
}

export const useRepo = create<RepoState>((set, get) => ({
  repoPath: null,
  loading: false,
  status: null,
  branches: [],
  commits: [],
  remotes: [],
  prs: [],
  ghAvailable: false,
  behindRemote: 0,

  open: async (repoPath) => {
    set({ loading: true });
    try {
      const resolved = await unwrap(window.gitApi.openRepo(repoPath));
      set({ repoPath: resolved });
      const available = (await maybe(window.ghApi.available())) ?? false;
      set({ ghAvailable: available });
      await get().refreshAll();
    } finally {
      set({ loading: false });
    }
  },

  refreshAll: async () => {
    await Promise.all([
      get().refreshStatus(),
      get().refreshBranches(),
      get().refreshLog({ all: true }),
      get().refreshRemotes(),
      get().refreshPRs(),
    ]);
  },

  refreshStatus: async () => {
    if (!get().repoPath) return;
    const status = await maybe(window.gitApi.status());
    if (status) set({ status });
  },

  refreshBranches: async () => {
    if (!get().repoPath) return;
    const branches = await maybe(window.gitApi.branches());
    if (branches) set({ branches });
  },

  refreshLog: async (opts) => {
    if (!get().repoPath) return;
    const commits = await maybe(window.gitApi.log({ all: opts?.all ?? true, limit: 500 }));
    if (commits) set({ commits });
  },

  refreshRemotes: async () => {
    if (!get().repoPath) return;
    const remotes = await maybe(window.gitApi.remotes());
    if (remotes) set({ remotes });
  },

  refreshPRs: async () => {
    if (!get().repoPath || !get().ghAvailable) {
      set({ prs: [] });
      return;
    }
    const prs = await maybe(window.ghApi.prList("open"));
    set({ prs: prs ?? [] });
  },

  setGhAvailable: (v) => set({ ghAvailable: v }),
  setBehindRemote: (v) => set({ behindRemote: v }),
}));
