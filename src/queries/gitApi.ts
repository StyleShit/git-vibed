import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
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
  return queryOptions({
    queryKey: [...repoKey(path ?? ""), "ghAvailable"] as const,
    // maybe() so a non-gh host never throws — resolve to false.
    queryFn: async () => (await maybe(window.ghApi.available())) ?? false,
    enabled: !!path,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

type PRStateFilter = "open" | "closed" | "all";

export function prsOptions(
  path: MaybePath,
  stateFilter: PRStateFilter,
  ghAvailable: boolean,
) {
  return queryOptions({
    queryKey: [...repoKey(path ?? ""), "prs", stateFilter] as const,
    queryFn: async () => (await maybe(window.ghApi.prList(stateFilter))) ?? [],
    // Gated on both a live tab AND ghAvailable so non-gh hosts don't
    // churn IPC. ghAvailable is itself a query; call sites compose
    // that result in as the third argument.
    enabled: !!path && ghAvailable,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
}
