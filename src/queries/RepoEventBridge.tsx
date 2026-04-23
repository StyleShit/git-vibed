import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { repoKey } from "./gitApi";

// Mapping mirrors App.tsx's existing refreshX fan-out:
//   head     -> status, branches, log, worktrees, undo
//   index    -> status, stashes
//   worktree -> same bucket as index today
//   refs     -> branches, log, tags
// Keep in sync with App.tsx until Step E removes the old listener.
type QueryKind =
  | "status"
  | "branches"
  | "log"
  | "remotes"
  | "prs"
  | "stashes"
  | "tags"
  | "worktrees"
  | "undo"
  | "ghAvailable";

const HEAD: QueryKind[] = ["status", "branches", "log", "worktrees", "undo"];
const INDEX: QueryKind[] = ["status", "stashes"];
const REFS: QueryKind[] = ["branches", "log", "tags"];
const FETCH_CHANGED: QueryKind[] = ["branches", "log", "tags", "status"];

// Translates main-process watcher events into TanStack Query
// invalidations. Runs in parallel with the zustand refresh* fan-out
// during Steps A–D; the old path is removed in Step E.
export function RepoEventBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    const invalidate = (path: string, kinds: QueryKind[]) => {
      for (const k of kinds) {
        qc.invalidateQueries({ queryKey: [...repoKey(path), k] });
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
