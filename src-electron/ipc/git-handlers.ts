import type { IpcMain } from "electron";
import type { RepoManager } from "../git/repo-manager.js";
import { GIT } from "../../src/shared/ipc.js";
import { parseUnifiedDiff } from "../git/parser.js";
import type {
  CommitOptions,
  FetchOptions,
  FileDiff,
  LogOptions,
  PullOptions,
  PushOptions,
  Result,
} from "../../src/shared/types.js";

// Wrap an async handler so all errors surface as Result<T> rather than
// bubbling up as unhandled rejections.
function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  return fn().then(
    (data) => ({ ok: true as const, data }),
    (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
  );
}

// Pulling the executor out once per handler keeps the call sites readable.
// Every handler routes through the active session — tab switches update the
// active key before the next request fires.
const exec = (repo: RepoManager) => repo.require().executor;

export function registerGitHandlers(ipc: IpcMain, repo: RepoManager) {
  ipc.handle(GIT.OPEN_REPO, (_e, repoPath: string) => wrap(() => repo.open(repoPath)));
  ipc.handle(GIT.CLOSE_REPO, (_e, repoPath: string) => wrap(() => repo.close(repoPath)));
  ipc.handle(GIT.SET_ACTIVE_REPO, (_e, repoPath: string) =>
    wrap(async () => repo.setActive(repoPath)),
  );
  ipc.handle(GIT.OPEN_REPOS, () =>
    wrap(async () => ({ paths: repo.openPaths, active: repo.activePath })),
  );

  ipc.handle(GIT.CURRENT_REPO, () =>
    wrap(async () => repo.activePath),
  );

  ipc.handle(GIT.STATUS, () => wrap(() => exec(repo).status()));

  ipc.handle(GIT.COMMIT, (_e, opts: CommitOptions) => wrap(() => exec(repo).commit(opts)));

  ipc.handle(GIT.STAGE, (_e, files: string[]) => wrap(() => exec(repo).stage(files)));
  ipc.handle(GIT.UNSTAGE, (_e, files: string[]) => wrap(() => exec(repo).unstage(files)));
  ipc.handle(GIT.STAGE_PATCH, (_e, patch: string) =>
    wrap(() => exec(repo).applyPatch(patch, false)),
  );
  ipc.handle(GIT.UNSTAGE_PATCH, (_e, patch: string) =>
    wrap(() => exec(repo).applyPatch(patch, true)),
  );
  ipc.handle(GIT.DISCARD_PATCH, (_e, patch: string) =>
    wrap(() => exec(repo).discardPatch(patch)),
  );
  ipc.handle(GIT.DISCARD, (_e, files: string[]) => wrap(() => exec(repo).discard(files)));
  ipc.handle(GIT.MARK_RESOLVED, (_e, files: string[]) =>
    wrap(() => exec(repo).markResolved(files)),
  );

  ipc.handle(
    GIT.DIFF,
    (
      _e,
      payload: { file: string; staged?: boolean; commitA?: string; commitB?: string },
    ) =>
      wrap(async (): Promise<FileDiff> => {
        const raw = await exec(repo).diff(payload.file, {
          staged: payload.staged,
          commitA: payload.commitA,
          commitB: payload.commitB,
        });
        const parsed = parseUnifiedDiff(raw);
        const f = parsed[0];
        if (!f) return { path: payload.file, binary: false, hunks: [], raw };
        return { path: f.path, oldPath: f.oldPath, binary: f.binary, hunks: f.hunks, raw: f.raw };
      }),
  );

  ipc.handle(GIT.LOG, (_e, opts: LogOptions = {}) => wrap(() => exec(repo).log(opts)));

  ipc.handle(GIT.BRANCHES, () => wrap(() => exec(repo).branches()));
  ipc.handle(GIT.BRANCH_CREATE, (_e, { name, base }: { name: string; base?: string }) =>
    wrap(() => exec(repo).branchCreate(name, base)),
  );
  ipc.handle(GIT.BRANCH_DELETE, (_e, { name, force }: { name: string; force?: boolean }) =>
    wrap(() => exec(repo).branchDelete(name, force)),
  );
  ipc.handle(
    GIT.BRANCH_RENAME,
    (_e, { oldName, newName }: { oldName: string; newName: string }) =>
      wrap(() => exec(repo).branchRename(oldName, newName)),
  );
  ipc.handle(
    GIT.BRANCH_SET_UPSTREAM,
    (_e, { branch, upstream }: { branch: string; upstream: string | null }) =>
      wrap(() => exec(repo).branchSetUpstream(branch, upstream)),
  );
  ipc.handle(GIT.CHECKOUT, (_e, branch: string) => wrap(() => exec(repo).checkout(branch)));
  ipc.handle(
    GIT.CHECKOUT_CREATE,
    (_e, { name, startPoint }: { name: string; startPoint: string }) =>
      wrap(() => exec(repo).checkoutCreate(name, startPoint)),
  );

  ipc.handle(GIT.MERGE, (_e, branch: string) => wrap(() => exec(repo).merge(branch)));
  ipc.handle(GIT.MERGE_ABORT, () => wrap(() => exec(repo).mergeAbort()));
  ipc.handle(GIT.REBASE, (_e, onto: string) => wrap(() => exec(repo).rebase(onto)));
  ipc.handle(GIT.REBASE_CONTINUE, () => wrap(() => exec(repo).rebaseContinue()));
  ipc.handle(GIT.REBASE_ABORT, () => wrap(() => exec(repo).rebaseAbort()));
  ipc.handle(GIT.REBASE_SKIP, () => wrap(() => exec(repo).rebaseSkip()));

  ipc.handle(GIT.CHERRY_PICK, (_e, hash: string) => wrap(() => exec(repo).cherryPick(hash)));
  ipc.handle(GIT.REVERT, (_e, hash: string) => wrap(() => exec(repo).revert(hash)));
  ipc.handle(
    GIT.RESET,
    (_e, { target, mode }: { target: string; mode: "soft" | "mixed" | "hard" }) =>
      wrap(() => exec(repo).reset(target, mode)),
  );
  ipc.handle(
    GIT.STASH,
    (_e, payload?: string | { message?: string; files?: string[] }) => {
      // Backwards-compat: older callers pass the message as a bare string.
      const opts =
        typeof payload === "string"
          ? { message: payload, files: undefined }
          : (payload ?? {});
      return wrap(() => exec(repo).stash(opts.message, opts.files));
    },
  );
  ipc.handle(GIT.STASH_POP, () => wrap(() => exec(repo).stashPop()));

  ipc.handle(GIT.PULL, (_e, opts: PullOptions) => wrap(() => exec(repo).pull(opts)));
  ipc.handle(GIT.PUSH, (_e, opts: PushOptions) => wrap(() => exec(repo).push(opts)));
  ipc.handle(GIT.FETCH, (_e, opts: FetchOptions) => wrap(() => exec(repo).fetch(opts)));
  ipc.handle(GIT.PULL_BRANCH, (_e, branch: string) =>
    wrap(() => exec(repo).pullBranch(branch)),
  );
  ipc.handle(
    GIT.PUSH_BRANCH,
    (_e, { branch, force }: { branch: string; force?: boolean }) =>
      wrap(() => exec(repo).pushBranch(branch, force)),
  );

  ipc.handle(GIT.REMOTES, () => wrap(() => exec(repo).remotes()));
  ipc.handle(GIT.REMOTE_ADD, (_e, { name, url }: { name: string; url: string }) =>
    wrap(() => exec(repo).remoteAdd(name, url)),
  );
  ipc.handle(GIT.REMOTE_REMOVE, (_e, name: string) => wrap(() => exec(repo).remoteRemove(name)));
  ipc.handle(
    GIT.REMOTE_SET_URL,
    (_e, { name, url, push }: { name: string; url: string; push?: boolean }) =>
      wrap(() => exec(repo).remoteSetUrl(name, url, push)),
  );

  ipc.handle(GIT.CONFIG_LIST, () => wrap(() => exec(repo).configList()));
  ipc.handle(
    GIT.CONFIG_GET,
    (_e, { key, scope }: { key: string; scope?: "local" | "global" | "system" }) =>
      wrap(() => exec(repo).configGet(key, scope)),
  );
  ipc.handle(
    GIT.CONFIG_SET,
    (_e, { key, value, scope }: { key: string; value: string; scope: "local" | "global" }) =>
      wrap(() => exec(repo).configSet(key, value, scope)),
  );

  ipc.handle(GIT.FILE_AT_REF, (_e, { ref, path: p }: { ref: string; path: string }) =>
    wrap(() => exec(repo).fileAtRef(ref, p)),
  );
  ipc.handle(
    GIT.WRITE_FILE,
    (_e, { path: p, content }: { path: string; content: string }) =>
      wrap(() => exec(repo).writeFile(p, content)),
  );
  ipc.handle(GIT.MERGE_MESSAGE, () => wrap(() => exec(repo).mergeMessage()));
  ipc.handle(GIT.CONFLICT_KIND, (_e, p: string) =>
    wrap(() => exec(repo).conflictKind(p)),
  );
  ipc.handle(
    GIT.RESOLVE_SIDE,
    (_e, { path: p, side }: { path: string; side: "ours" | "theirs" }) =>
      wrap(() => exec(repo).resolveWithSide(p, side)),
  );
  ipc.handle(GIT.RESOLVE_DELETE, (_e, p: string) =>
    wrap(() => exec(repo).resolveWithDelete(p)),
  );
  ipc.handle(
    GIT.FIND_RENAME_TARGET,
    (_e, { path: p, side }: { path: string; side: "ours" | "theirs" }) =>
      wrap(() => exec(repo).findRenameTarget(p, side)),
  );

  ipc.handle(GIT.STASH_LIST, () => wrap(() => exec(repo).stashList()));
  ipc.handle(GIT.STASH_APPLY, (_e, index: number) => wrap(() => exec(repo).stashApply(index)));
  ipc.handle(GIT.STASH_DROP, (_e, index: number) => wrap(() => exec(repo).stashDrop(index)));
  ipc.handle(GIT.STASH_SHOW, (_e, index: number) => wrap(() => exec(repo).stashShow(index)));
  ipc.handle(GIT.STASH_SHOW_FILES, (_e, index: number) =>
    wrap(() => exec(repo).stashShowFiles(index)),
  );

  ipc.handle(GIT.TAGS, () => wrap(() => exec(repo).tags()));
  ipc.handle(
    GIT.TAG_CREATE,
    (_e, { name, ref, message }: { name: string; ref: string; message?: string }) =>
      wrap(() => exec(repo).tagCreate(name, ref, message)),
  );
  ipc.handle(GIT.TAG_DELETE, (_e, name: string) => wrap(() => exec(repo).tagDelete(name)));

  ipc.handle(GIT.WORKTREE_LIST, () => wrap(() => exec(repo).worktrees()));
  ipc.handle(
    GIT.WORKTREE_ADD,
    (
      _e,
      { path: p, branch, createBranch }: { path: string; branch: string; createBranch?: boolean },
    ) => wrap(() => exec(repo).worktreeAdd(p, branch, createBranch)),
  );
  ipc.handle(
    GIT.WORKTREE_REMOVE,
    (_e, { path: p, force }: { path: string; force?: boolean }) =>
      wrap(() => exec(repo).worktreeRemove(p, force)),
  );
  ipc.handle(
    GIT.WORKTREE_LOCK,
    (_e, { path: p, reason }: { path: string; reason?: string }) =>
      wrap(() => exec(repo).worktreeLock(p, reason)),
  );
  ipc.handle(GIT.WORKTREE_UNLOCK, (_e, p: string) =>
    wrap(() => exec(repo).worktreeUnlock(p)),
  );

  ipc.handle(GIT.COMMIT_FILES, (_e, hash: string) => wrap(() => exec(repo).commitFiles(hash)));

  ipc.handle(GIT.UNDO_HEAD, () => wrap(() => repo.require().headUndo()));
  ipc.handle(GIT.REDO_HEAD, () => wrap(() => repo.require().headRedo()));
  ipc.handle(GIT.UNDO_STATE, () =>
    wrap(async () => {
      try {
        return await repo.require().undoState();
      } catch {
        // No active repo yet (e.g. called on startup before a tab is
        // open). Return a neutral state instead of surfacing the error.
        return { canUndo: false, canRedo: false };
      }
    }),
  );
}
