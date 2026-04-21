import { contextBridge, ipcRenderer } from "electron";
import { GIT, GH, EVENTS } from "../src/shared/ipc.js";
import type {
  CommitOptions,
  FetchOptions,
  LogOptions,
  PullOptions,
  PushOptions,
  PRCreateOptions,
  PRReviewOptions,
  MergeMethod,
  Result,
  Branch,
  Commit,
  RepoStatus,
  FileDiff,
  Remote,
  ConfigEntry,
  PullRequest,
  Check,
  RepoChangedEvent,
  FetchCompleteEvent,
} from "../src/shared/types.js";

// Helper wraps the invoke call so callers always get a typed Result<T>.
const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<Result<T>>;

const gitApi = {
  openRepo: (repoPath: string) => invoke<string>(GIT.OPEN_REPO, repoPath),
  currentRepo: () => invoke<string | null>(GIT.CURRENT_REPO),
  showOpenDialog: () => invoke<string>(GIT.SHOW_OPEN_DIALOG),
  openExternal: (url: string) => invoke<boolean>(GIT.OPEN_EXTERNAL, url),
  recentRepos: () => invoke<string[]>(GIT.RECENT_REPOS),

  status: () => invoke<RepoStatus>(GIT.STATUS),
  commit: (opts: CommitOptions) => invoke<string>(GIT.COMMIT, opts),
  stage: (files: string[]) => invoke<void>(GIT.STAGE, files),
  unstage: (files: string[]) => invoke<void>(GIT.UNSTAGE, files),
  stagePatch: (patch: string) => invoke<void>(GIT.STAGE_PATCH, patch),
  unstagePatch: (patch: string) => invoke<void>(GIT.UNSTAGE_PATCH, patch),
  discard: (files: string[]) => invoke<void>(GIT.DISCARD, files),
  markResolved: (files: string[]) => invoke<void>(GIT.MARK_RESOLVED, files),

  diff: (file: string, opts?: { staged?: boolean; commitA?: string; commitB?: string }) =>
    invoke<FileDiff>(GIT.DIFF, { file, ...opts }),

  log: (opts?: LogOptions) => invoke<Commit[]>(GIT.LOG, opts),
  branches: () => invoke<Branch[]>(GIT.BRANCHES),
  branchCreate: (name: string, base?: string) =>
    invoke<void>(GIT.BRANCH_CREATE, { name, base }),
  branchDelete: (name: string, force?: boolean) =>
    invoke<void>(GIT.BRANCH_DELETE, { name, force }),
  branchRename: (oldName: string, newName: string) =>
    invoke<void>(GIT.BRANCH_RENAME, { oldName, newName }),
  checkout: (branch: string) => invoke<void>(GIT.CHECKOUT, branch),
  merge: (branch: string) => invoke<{ conflicts: string[] }>(GIT.MERGE, branch),
  rebase: (onto: string) => invoke<{ conflicts: string[] }>(GIT.REBASE, onto),
  rebaseContinue: () => invoke<{ conflicts: string[] }>(GIT.REBASE_CONTINUE),
  rebaseAbort: () => invoke<void>(GIT.REBASE_ABORT),
  rebaseSkip: () => invoke<{ conflicts: string[] }>(GIT.REBASE_SKIP),
  mergeAbort: () => invoke<void>(GIT.MERGE_ABORT),
  cherryPick: (hash: string) => invoke<void>(GIT.CHERRY_PICK, hash),
  revert: (hash: string) => invoke<void>(GIT.REVERT, hash),
  reset: (target: string, mode: "soft" | "mixed" | "hard") =>
    invoke<void>(GIT.RESET, { target, mode }),
  stash: (message?: string) => invoke<void>(GIT.STASH, message),
  stashPop: () => invoke<void>(GIT.STASH_POP),

  pull: (opts: PullOptions) => invoke<string>(GIT.PULL, opts),
  push: (opts: PushOptions) => invoke<string>(GIT.PUSH, opts),
  fetch: (opts: FetchOptions) => invoke<string>(GIT.FETCH, opts),

  remotes: () => invoke<Remote[]>(GIT.REMOTES),
  remoteAdd: (name: string, url: string) => invoke<void>(GIT.REMOTE_ADD, { name, url }),
  remoteRemove: (name: string) => invoke<void>(GIT.REMOTE_REMOVE, name),
  remoteSetUrl: (name: string, url: string, push?: boolean) =>
    invoke<void>(GIT.REMOTE_SET_URL, { name, url, push }),

  configList: () => invoke<ConfigEntry[]>(GIT.CONFIG_LIST),
  configGet: (key: string, scope?: "local" | "global" | "system") =>
    invoke<string | null>(GIT.CONFIG_GET, { key, scope }),
  configSet: (key: string, value: string, scope: "local" | "global") =>
    invoke<void>(GIT.CONFIG_SET, { key, value, scope }),

  fileAtRef: (ref: string, filePath: string) =>
    invoke<string>(GIT.FILE_AT_REF, { ref, path: filePath }),

  onRepoChanged: (cb: (e: RepoChangedEvent) => void) => {
    const handler = (_: unknown, payload: RepoChangedEvent) => cb(payload);
    ipcRenderer.on(EVENTS.REPO_CHANGED, handler);
    return () => ipcRenderer.removeListener(EVENTS.REPO_CHANGED, handler);
  },
  onFetchComplete: (cb: (e: FetchCompleteEvent) => void) => {
    const handler = (_: unknown, payload: FetchCompleteEvent) => cb(payload);
    ipcRenderer.on(EVENTS.FETCH_COMPLETE, handler);
    return () => ipcRenderer.removeListener(EVENTS.FETCH_COMPLETE, handler);
  },
};

const ghApi = {
  available: () => invoke<boolean>(GH.AVAILABLE),
  prList: (state?: "open" | "closed" | "all") => invoke<PullRequest[]>(GH.PR_LIST, state),
  prView: (number: number) => invoke<PullRequest>(GH.PR_VIEW, number),
  prCreate: (opts: PRCreateOptions) => invoke<PullRequest>(GH.PR_CREATE, opts),
  prMerge: (number: number, method: MergeMethod) =>
    invoke<void>(GH.PR_MERGE, { number, method }),
  prChecks: (number: number) => invoke<Check[]>(GH.PR_CHECKS, number),
  prReview: (opts: PRReviewOptions) => invoke<void>(GH.PR_REVIEW, opts),
  repoInfo: () =>
    invoke<{ name: string; owner: string; defaultBranch: string; host: string }>(GH.REPO_INFO),
  collaborators: () => invoke<string[]>(GH.COLLABORATORS),
};

contextBridge.exposeInMainWorld("gitApi", gitApi);
contextBridge.exposeInMainWorld("ghApi", ghApi);

export type GitApi = typeof gitApi;
export type GhApi = typeof ghApi;
