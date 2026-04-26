import { useQuery } from "@tanstack/react-query";
import type { FileChange, Worktree } from "@shared/types";
import { gitStatusOptions, gitWorktreesOptions } from "./gitApi";

// Linked worktrees nested under the repo path show up as "untracked"
// in `git status` (the dir entry itself is unknown to the parent's
// index). They aren't actually pending changes — they're separate
// working trees git happens to see — so every consumer that displays
// a "uncommitted changes" count should exclude them.
//
// ChangesPanel applied this filter inline; the count-only consumers
// (Toolbar badge, CommitDetail "Show changes" strip, BranchGraph
// banner) didn't, which is why a single nested-worktree directory
// produced "1 uncommitted change" with an empty staging panel.

export function worktreesRelativeToRepo(
  worktrees: Worktree[],
  repoPath: string,
): string[] {
  if (!repoPath) return [];
  const norm = repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const rels: string[] = [];
  for (const w of worktrees) {
    if (w.isMain) continue;
    const wp = w.path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (wp.startsWith(norm + "/")) {
      rels.push(wp.slice(norm.length + 1));
    }
  }
  return rels;
}

export function isWorktreePath(filePath: string, worktreeRels: string[]): boolean {
  // simple-git surfaces untracked dirs with a trailing slash
  // (".claude/worktrees/X/"); strip it before comparing so equality
  // and prefix tests both work.
  const p = filePath.replace(/\/+$/, "");
  for (const rel of worktreeRels) {
    if (p === rel || p.startsWith(rel + "/")) return true;
  }
  return false;
}

// Total count of pending changes excluding linked-worktree paths.
// Reads the same two queries ChangesPanel does, so subscribers stay
// in sync with what the panel actually displays.
export function useWipCount(path: string | null | undefined): number {
  const status = useQuery(gitStatusOptions(path)).data;
  const worktrees = useQuery(gitWorktreesOptions(path)).data ?? [];
  if (!status) return 0;
  const wtRels = worktreesRelativeToRepo(worktrees, path ?? "");
  const notWorktree = (f: FileChange) => !isWorktreePath(f.path, wtRels);
  return (
    status.staged.filter(notWorktree).length +
    status.unstaged.filter(notWorktree).length +
    status.conflicted.filter(notWorktree).length
  );
}
