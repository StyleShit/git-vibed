import { queryOptions, useQuery } from "@tanstack/react-query";
import { unwrap } from "../lib/ipc";

// Every query under a tab sits under the same prefix so one
// `invalidateQueries({ queryKey: repoKey(path) })` nukes the whole tab.
export function repoKey(path: string) {
  return ["repo", path] as const;
}

// Query-options factories are the canonical form — they give us a single
// typed object that can feed useQuery, prefetchQuery, ensureQueryData,
// invalidateQueries({ queryKey }), and setQueryData without duplicating
// the key shape at every call site.

export function gitStatusOptions(path: string) {
  return queryOptions({
    queryKey: [...repoKey(path), "status"] as const,
    queryFn: () => unwrap(window.gitApi.status()),
    staleTime: 0,
    gcTime: 5 * 60_000,
  });
}

export function useGitStatus(path: string | null | undefined) {
  return useQuery({
    ...gitStatusOptions(path ?? ""),
    enabled: !!path,
  });
}
