import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { repoKey } from "./gitApi";

// Mapping mirrors the watcher's event types:
//   head     -> status, branches, log, worktrees, undo
//   index    -> status, stashes, WIP diff (the file the user has open)
//   worktree -> same bucket as index
//   refs     -> branches, log, tags
//
// Each entry is a key suffix appended to `repoKey(path)` — multi-segment
// suffixes (like ["diff", "wip"]) invalidate every WIP-diff query at
// that prefix in one call.
type KeySuffix = readonly string[];

const HEAD: KeySuffix[] = [
  ["status"],
  ["branches"],
  ["log"],
  ["worktrees"],
  ["undo"],
];
const INDEX: KeySuffix[] = [["status"], ["stashes"], ["diff", "wip"]];
const REFS: KeySuffix[] = [["branches"], ["log"], ["tags"]];
const FETCH_CHANGED: KeySuffix[] = [
  ["branches"],
  ["log"],
  ["tags"],
  ["status"],
];

// Translates main-process watcher events into TanStack Query
// invalidations. The only path the watcher uses to push state into
// the cache.
export function RepoEventBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    const invalidate = (path: string, suffixes: KeySuffix[]) => {
      for (const suffix of suffixes) {
        qc.invalidateQueries({ queryKey: [...repoKey(path), ...suffix] });
      }
    };

    const offChanged = window.gitApi.onRepoChanged(({ repoPath, type }) => {
      if (type === "index" || type === "worktree") invalidate(repoPath, INDEX);
      else if (type === "head") invalidate(repoPath, HEAD);
      else if (type === "refs") invalidate(repoPath, REFS);
    });

    // Watcher skips refs/remotes/** to dodge EMFILE, so fetch completion
    // is the only signal that remote branches / tags moved.
    const offFetch = window.gitApi.onFetchComplete((e) => {
      if (e.changed) invalidate(e.repoPath, FETCH_CHANGED);
    });

    return () => {
      offChanged();
      offFetch();
    };
  }, [qc]);

  return null;
}
