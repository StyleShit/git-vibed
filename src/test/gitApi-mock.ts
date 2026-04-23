import { vi, type Mock } from "vitest";
import type {
  Branch,
  Commit,
  RepoStatus,
  RepoChangedEvent,
  FetchStartEvent,
  FetchCompleteEvent,
  UndoState,
} from "@shared/types";

type RepoChangedCb = (e: RepoChangedEvent) => void;
type FetchStartCb = (e: FetchStartEvent) => void;
type FetchCompleteCb = (e: FetchCompleteEvent) => void;

// Shape of the mock we hand back to tests. Each method is a Vitest mock fn
// that returns the default ok result; tests override via `mock.stub("stage",
// () => …)` or by indexing into `api`.
export interface GitApiMock {
  api: Record<string, Mock>;
  stub: <T>(method: string, impl: (...args: unknown[]) => Promise<T> | T) => void;
  fireRepoChanged: (e: RepoChangedEvent) => void;
  fireFetchStart: (e: FetchStartEvent) => void;
  fireFetchComplete: (e: FetchCompleteEvent) => void;
}

export const EMPTY_STATUS: RepoStatus = {
  repoPath: "/repo",
  branch: "main",
  detached: false,
  ahead: 0,
  behind: 0,
  tracking: null,
  staged: [],
  unstaged: [],
  conflicted: [],
  mergeInProgress: false,
  rebaseInProgress: false,
};

export const EMPTY_UNDO: UndoState = {
  canUndo: false,
  canRedo: false,
};

const DEFAULTS: Record<string, unknown> = {
  openRepo: "/repo",
  closeRepo: [],
  setActiveRepo: "/repo",
  openRepos: { paths: [], active: null },
  currentRepo: null,
  showOpenDialog: "/repo",
  openExternal: true,
  recentRepos: [],
  sessionGet: { openPaths: [], activePath: null },
  sessionSet: true,
  setAutoFetchInterval: 0,

  status: EMPTY_STATUS,
  commit: "abc123",
  stage: undefined,
  unstage: undefined,
  stagePatch: undefined,
  unstagePatch: undefined,
  discardPatch: undefined,
  discard: undefined,
  markResolved: undefined,

  diff: { hunks: [], raw: "", binary: false },

  log: [] as Commit[],
  branches: [] as Branch[],
  branchCreate: undefined,
  branchDelete: undefined,
  branchRename: undefined,
  branchSetUpstream: undefined,
  checkout: undefined,
  checkoutCreate: undefined,
  merge: { conflicts: [] },
  rebase: { conflicts: [] },
  rebaseContinue: { conflicts: [] },
  rebaseAbort: undefined,
  rebaseSkip: { conflicts: [] },
  mergeAbort: undefined,
  cherryPick: undefined,
  revert: undefined,
  reset: undefined,
  stash: undefined,
  stashPop: undefined,

  pull: "",
  push: "",
  fetch: "",
  pullBranch: "",
  pushBranch: "",

  remotes: [],
  remoteAdd: undefined,
  remoteRemove: undefined,
  remoteSetUrl: undefined,

  configList: [],
  configGet: null,
  configSet: undefined,

  fileAtRef: "",
  writeFile: undefined,
  mergeMessage: "",
  conflictKind: "both-modified",
  resolveWithSide: undefined,
  resolveWithDelete: undefined,
  findRenameTarget: null,

  stashList: [],
  stashApply: undefined,
  stashDrop: undefined,
  stashShow: "",
  stashShowFiles: [],

  tags: [],
  tagCreate: undefined,
  tagDelete: undefined,

  worktreeList: [],
  worktreeAdd: undefined,
  worktreeRemove: undefined,
  worktreeLock: undefined,
  worktreeUnlock: undefined,

  commitFiles: [],

  undoHead: { label: null },
  redoHead: { label: null },
  undoState: EMPTY_UNDO,
};

export function createGitApiMock(): GitApiMock {
  const repoChangedListeners = new Set<RepoChangedCb>();
  const fetchStartListeners = new Set<FetchStartCb>();
  const fetchCompleteListeners = new Set<FetchCompleteCb>();

  const api: Record<string, Mock> = {};
  for (const [name, value] of Object.entries(DEFAULTS)) {
    api[name] = vi.fn(async () => ({ ok: true, data: value }));
  }

  api.onRepoChanged = vi.fn((cb: RepoChangedCb) => {
    repoChangedListeners.add(cb);
    return () => repoChangedListeners.delete(cb);
  });
  api.onFetchStart = vi.fn((cb: FetchStartCb) => {
    fetchStartListeners.add(cb);
    return () => fetchStartListeners.delete(cb);
  });
  api.onFetchComplete = vi.fn((cb: FetchCompleteCb) => {
    fetchCompleteListeners.add(cb);
    return () => fetchCompleteListeners.delete(cb);
  });

  return {
    api,
    stub<T>(method: string, impl: (...args: unknown[]) => Promise<T> | T) {
      api[method] = vi.fn(async (...args: unknown[]) => {
        const value = await impl(...args);
        return { ok: true, data: value };
      });
    },
    fireRepoChanged(e) {
      for (const cb of repoChangedListeners) cb(e);
    },
    fireFetchStart(e) {
      for (const cb of fetchStartListeners) cb(e);
    },
    fireFetchComplete(e) {
      for (const cb of fetchCompleteListeners) cb(e);
    },
  };
}
