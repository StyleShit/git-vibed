import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { maybe, unwrap } from "../lib/ipc";

// Build query keys so every query in a tab's namespace can be
// invalidated with a single prefix invalidation.
export function repoKey(path: string) {
  return ["repo", path] as const;
}

// Query-options factories are the canonical form — they give us a single
// typed object that can feed useQuery, prefetchQuery, ensureQueryData,
// invalidateQueries({ queryKey }), and setQueryData without duplicating
// the key shape at every call site.

export const LOG_PAGE_SIZE = 500;

export function gitStatusOptions(path: string) {
  return queryOptions({
    queryKey: [...repoKey(path), "status"] as const,
    queryFn: () => unwrap(window.gitApi.status()),
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

export function useGitStatus(path: string | null | undefined) {
  return useQuery({
    ...gitStatusOptions(path ?? ""),
    enabled: !!path,
  });
}

export function gitBranchesOptions(path: string) {
  return queryOptions({
    queryKey: [...repoKey(path), "branches"] as const,
    queryFn: () => unwrap(window.gitApi.branches()),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useGitBranches(path: string | null | undefined) {
  return useQuery({
    ...gitBranchesOptions(path ?? ""),
    enabled: !!path,
  });
}

export function gitLogOptions(path: string) {
  return infiniteQueryOptions({
    queryKey: [...repoKey(path), "log"] as const,
    queryFn: ({ pageParam }) =>
      unwrap(
        window.gitApi.log({
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
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useGitLog(path: string | null | undefined) {
  return useInfiniteQuery({
    ...gitLogOptions(path ?? ""),
    enabled: !!path,
  });
}

export function gitRemotesOptions(path: string) {
  return queryOptions({
    queryKey: [...repoKey(path), "remotes"] as const,
    queryFn: () => unwrap(window.gitApi.remotes()),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}

export function useGitRemotes(path: string | null | undefined) {
  return useQuery({
    ...gitRemotesOptions(path ?? ""),
    enabled: !!path,
  });
}

export function gitStashesOptions(path: string) {
  return queryOptions({
    queryKey: [...repoKey(path), "stashes"] as const,
    queryFn: () => unwrap(window.gitApi.stashList()),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useGitStashes(path: string | null | undefined) {
  return useQuery({
    ...gitStashesOptions(path ?? ""),
    enabled: !!path,
  });
}

export function gitTagsOptions(path: string) {
  return queryOptions({
    queryKey: [...repoKey(path), "tags"] as const,
    queryFn: () => unwrap(window.gitApi.tags()),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

export function useGitTags(path: string | null | undefined) {
  return useQuery({
    ...gitTagsOptions(path ?? ""),
    enabled: !!path,
  });
}

export function gitWorktreesOptions(path: string) {
  return queryOptions({
    queryKey: [...repoKey(path), "worktrees"] as const,
    queryFn: () => unwrap(window.gitApi.worktreeList()),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

export function useGitWorktrees(path: string | null | undefined) {
  return useQuery({
    ...gitWorktreesOptions(path ?? ""),
    enabled: !!path,
  });
}

export function gitUndoOptions(path: string) {
  return queryOptions({
    queryKey: [...repoKey(path), "undo"] as const,
    queryFn: () => unwrap(window.gitApi.undoState()),
    staleTime: 0,
    gcTime: 5 * 60_000,
  });
}

export function useGitUndo(path: string | null | undefined) {
  return useQuery({
    ...gitUndoOptions(path ?? ""),
    enabled: !!path,
  });
}

export function ghAvailableOptions(path: string) {
  return queryOptions({
    queryKey: [...repoKey(path), "ghAvailable"] as const,
    // maybe() so a non-gh host never throws — resolve to false.
    queryFn: async () => (await maybe(window.ghApi.available())) ?? false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useGhAvailable(path: string | null | undefined) {
  return useQuery({
    ...ghAvailableOptions(path ?? ""),
    enabled: !!path,
  });
}

type PRStateFilter = "open" | "closed" | "all";

export function prsOptions(
  path: string,
  stateFilter: PRStateFilter,
  ghAvailable: boolean,
) {
  return queryOptions({
    queryKey: [...repoKey(path), "prs", stateFilter] as const,
    queryFn: async () => (await maybe(window.ghApi.prList(stateFilter))) ?? [],
    // Gated on ghAvailable so non-gh hosts don't churn IPC. Flip the gate
    // via `enabled` at the use-site — ghAvailable is itself a query.
    enabled: ghAvailable,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
}

export function usePRs(
  path: string | null | undefined,
  stateFilter: PRStateFilter,
  ghAvailable: boolean,
) {
  return useQuery({
    ...prsOptions(path ?? "", stateFilter, ghAvailable),
    enabled: !!path && ghAvailable,
  });
}
