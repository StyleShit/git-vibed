import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from "@tanstack/react-query";
import { maybe, unwrap } from "../lib/ipc";

// Every query under a tab sits under the same prefix so one
// `invalidateQueries({ queryKey: repoKey(path) })` nukes the whole tab.
export function repoKey(path: string) {
  return ["repo", path] as const;
}

// queryOptions factories are the canonical shape. Each one takes a
// possibly-null path and bakes in `enabled: !!path`, so call sites
// pass the raw active-tab path without guarding:
//
//   const { data } = useQuery(gitStatusOptions(activeTab?.path));
//
// Mutations + tests import the factory and use `.queryKey` (typed) for
// invalidation / setQueryData — no string duplication anywhere.

type MaybePath = string | null | undefined;

export const LOG_PAGE_SIZE = 500;

export function gitStatusOptions(path: MaybePath) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "status"] as const,
    queryFn: () => unwrap(window.gitApi.status(p)),
    enabled: !!path,
    staleTime: 0,
    gcTime: 5 * 60_000,
    // Work-tree edits never touch .git, so the main-process watcher
    // doesn't see them. Poll every 5s while the window is visible to
    // catch drift, and refetch on window focus for the same reason.
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function gitBranchesOptions(path: MaybePath) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "branches"] as const,
    queryFn: () => unwrap(window.gitApi.branches(p)),
    enabled: !!path,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function gitLogOptions(path: MaybePath) {
  const p = path ?? "";
  return infiniteQueryOptions({
    queryKey: [...repoKey(p), "log"] as const,
    queryFn: ({ pageParam }) =>
      unwrap(
        window.gitApi.log(p, {
          all: true,
          limit: LOG_PAGE_SIZE,
          skip: pageParam,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < LOG_PAGE_SIZE
        ? undefined
        : allPages.reduce((n, p) => n + p.length, 0),
    enabled: !!path,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function gitRemotesOptions(path: MaybePath) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "remotes"] as const,
    queryFn: () => unwrap(window.gitApi.remotes(p)),
    enabled: !!path,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}

export function gitStashesOptions(path: MaybePath) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "stashes"] as const,
    queryFn: () => unwrap(window.gitApi.stashList(p)),
    enabled: !!path,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function gitTagsOptions(path: MaybePath) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "tags"] as const,
    queryFn: () => unwrap(window.gitApi.tags(p)),
    enabled: !!path,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

export function gitWorktreesOptions(path: MaybePath) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "worktrees"] as const,
    queryFn: () => unwrap(window.gitApi.worktreeList(p)),
    enabled: !!path,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

export function gitUndoOptions(path: MaybePath) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "undo"] as const,
    queryFn: () => unwrap(window.gitApi.undoState(p)),
    enabled: !!path,
    staleTime: 0,
    gcTime: 5 * 60_000,
  });
}

export function ghAvailableOptions(path: MaybePath) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "ghAvailable"] as const,
    // maybe() so a non-gh host never throws — resolve to false.
    queryFn: async () => (await maybe(window.ghApi.available(p))) ?? false,
    enabled: !!path,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

// Detail-view queries — keyed by the immutable identifier (commit hash,
// stash index, etc.). Cached forever since the content never changes for
// a given id; only the WIP diff has staleTime: 0 and is invalidated by
// the index/worktree watcher events via RepoEventBridge.

// `placeholderData: keepPreviousData` preserves the previous file's
// data while a new key fetches — the user sees the old diff/file list
// instead of a "Loading…" flash on every selection change. The old
// useEffect+useState code base had this behavior implicitly by not
// resetting state to null on the new selection.

export function commitFilesOptions(path: MaybePath, hash: string) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "commit-files", hash] as const,
    queryFn: () => unwrap(window.gitApi.commitFiles(p, hash)),
    enabled: !!path && !!hash,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function commitDiffOptions(path: MaybePath, hash: string, file: string) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "diff", "commit", hash, file] as const,
    queryFn: () =>
      unwrap(window.gitApi.diff(p, file, { commitA: `${hash}^`, commitB: hash })),
    enabled: !!path && !!hash && !!file,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function wipDiffOptions(path: MaybePath, file: string, staged: boolean) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "diff", "wip", file, staged] as const,
    queryFn: () => unwrap(window.gitApi.diff(p, file, { staged })),
    enabled: !!path && !!file,
    staleTime: 0,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    // Same polling as gitStatusOptions: work-tree edits never touch
    // .git, so the watcher doesn't see them. Without this, editing
    // the open file in another editor leaves the diff stale until
    // the user closes and re-opens it. Only the *active* diff query
    // polls (TanStack default), so this is one IPC every 5s.
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function stashFilesOptions(path: MaybePath, index: number) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "stash-files", index] as const,
    queryFn: () => unwrap(window.gitApi.stashShowFiles(p, index)),
    enabled: !!path && index >= 0,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

type PRStateFilter = "open" | "closed" | "all";

export function prsOptions(
  path: MaybePath,
  stateFilter: PRStateFilter,
  ghAvailable: boolean,
) {
  const p = path ?? "";
  return queryOptions({
    queryKey: [...repoKey(p), "prs", stateFilter] as const,
    queryFn: async () => (await maybe(window.ghApi.prList(p, stateFilter))) ?? [],
    // Gated on both a live tab AND ghAvailable so non-gh hosts don't
    // churn IPC. ghAvailable is itself a query; call sites compose
    // that result in as the third argument.
    enabled: !!path && ghAvailable,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
}
