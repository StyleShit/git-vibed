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

function requireExec(repo: RepoManager) {
  const exec = repo.executor;
  if (!exec) throw new Error("No repository is currently open");
  return exec;
}

export function registerGitHandlers(ipc: IpcMain, repo: RepoManager) {
  ipc.handle(GIT.OPEN_REPO, (_e, repoPath: string) => wrap(() => repo.open(repoPath)));

  ipc.handle(GIT.CURRENT_REPO, () =>
    wrap(async () => repo.repoPath),
  );

  ipc.handle(GIT.STATUS, () => wrap(() => requireExec(repo).status()));

  ipc.handle(GIT.COMMIT, (_e, opts: CommitOptions) =>
    wrap(() => requireExec(repo).commit(opts)),
  );

  ipc.handle(GIT.STAGE, (_e, files: string[]) =>
    wrap(() => requireExec(repo).stage(files)),
  );
  ipc.handle(GIT.UNSTAGE, (_e, files: string[]) =>
    wrap(() => requireExec(repo).unstage(files)),
  );
  ipc.handle(GIT.STAGE_PATCH, (_e, patch: string) =>
    wrap(() => requireExec(repo).applyPatch(patch, false)),
  );
  ipc.handle(GIT.UNSTAGE_PATCH, (_e, patch: string) =>
    wrap(() => requireExec(repo).applyPatch(patch, true)),
  );
  ipc.handle(GIT.DISCARD, (_e, files: string[]) =>
    wrap(() => requireExec(repo).discard(files)),
  );
  ipc.handle(GIT.MARK_RESOLVED, (_e, files: string[]) =>
    wrap(() => requireExec(repo).markResolved(files)),
  );

  ipc.handle(GIT.DIFF, (_e, payload: { file: string; staged?: boolean; commitA?: string; commitB?: string }) =>
    wrap(async (): Promise<FileDiff> => {
      const exec = requireExec(repo);
      const raw = await exec.diff(payload.file, {
        staged: payload.staged,
        commitA: payload.commitA,
        commitB: payload.commitB,
      });
      const parsed = parseUnifiedDiff(raw);
      const f = parsed[0];
      if (!f) {
        return { path: payload.file, binary: false, hunks: [], raw };
      }
      return { path: f.path, oldPath: f.oldPath, binary: f.binary, hunks: f.hunks, raw: f.raw };
    }),
  );

  ipc.handle(GIT.LOG, (_e, opts: LogOptions = {}) =>
    wrap(() => requireExec(repo).log(opts)),
  );

  ipc.handle(GIT.BRANCHES, () => wrap(() => requireExec(repo).branches()));
  ipc.handle(GIT.BRANCH_CREATE, (_e, { name, base }: { name: string; base?: string }) =>
    wrap(() => requireExec(repo).branchCreate(name, base)),
  );
  ipc.handle(GIT.BRANCH_DELETE, (_e, { name, force }: { name: string; force?: boolean }) =>
    wrap(() => requireExec(repo).branchDelete(name, force)),
  );
  ipc.handle(GIT.BRANCH_RENAME, (_e, { oldName, newName }: { oldName: string; newName: string }) =>
    wrap(() => requireExec(repo).branchRename(oldName, newName)),
  );
  ipc.handle(GIT.CHECKOUT, (_e, branch: string) =>
    wrap(() => requireExec(repo).checkout(branch)),
  );

  ipc.handle(GIT.MERGE, (_e, branch: string) =>
    wrap(() => requireExec(repo).merge(branch)),
  );
  ipc.handle(GIT.MERGE_ABORT, () => wrap(() => requireExec(repo).mergeAbort()));
  ipc.handle(GIT.REBASE, (_e, onto: string) => wrap(() => requireExec(repo).rebase(onto)));
  ipc.handle(GIT.REBASE_CONTINUE, () => wrap(() => requireExec(repo).rebaseContinue()));
  ipc.handle(GIT.REBASE_ABORT, () => wrap(() => requireExec(repo).rebaseAbort()));
  ipc.handle(GIT.REBASE_SKIP, () => wrap(() => requireExec(repo).rebaseSkip()));

  ipc.handle(GIT.CHERRY_PICK, (_e, hash: string) =>
    wrap(() => requireExec(repo).cherryPick(hash)),
  );
  ipc.handle(GIT.REVERT, (_e, hash: string) => wrap(() => requireExec(repo).revert(hash)));
  ipc.handle(GIT.RESET, (_e, { target, mode }: { target: string; mode: "soft" | "mixed" | "hard" }) =>
    wrap(() => requireExec(repo).reset(target, mode)),
  );
  ipc.handle(GIT.STASH, (_e, message?: string) => wrap(() => requireExec(repo).stash(message)));
  ipc.handle(GIT.STASH_POP, () => wrap(() => requireExec(repo).stashPop()));

  ipc.handle(GIT.PULL, (_e, opts: PullOptions) => wrap(() => requireExec(repo).pull(opts)));
  ipc.handle(GIT.PUSH, (_e, opts: PushOptions) => wrap(() => requireExec(repo).push(opts)));
  ipc.handle(GIT.FETCH, (_e, opts: FetchOptions) => wrap(() => requireExec(repo).fetch(opts)));

  ipc.handle(GIT.REMOTES, () => wrap(() => requireExec(repo).remotes()));
  ipc.handle(GIT.REMOTE_ADD, (_e, { name, url }: { name: string; url: string }) =>
    wrap(() => requireExec(repo).remoteAdd(name, url)),
  );
  ipc.handle(GIT.REMOTE_REMOVE, (_e, name: string) =>
    wrap(() => requireExec(repo).remoteRemove(name)),
  );
  ipc.handle(
    GIT.REMOTE_SET_URL,
    (_e, { name, url, push }: { name: string; url: string; push?: boolean }) =>
      wrap(() => requireExec(repo).remoteSetUrl(name, url, push)),
  );

  ipc.handle(GIT.CONFIG_LIST, () => wrap(() => requireExec(repo).configList()));
  ipc.handle(GIT.CONFIG_GET, (_e, { key, scope }: { key: string; scope?: "local" | "global" | "system" }) =>
    wrap(() => requireExec(repo).configGet(key, scope)),
  );
  ipc.handle(
    GIT.CONFIG_SET,
    (_e, { key, value, scope }: { key: string; value: string; scope: "local" | "global" }) =>
      wrap(() => requireExec(repo).configSet(key, value, scope)),
  );

  ipc.handle(GIT.FILE_AT_REF, (_e, { ref, path: p }: { ref: string; path: string }) =>
    wrap(() => requireExec(repo).fileAtRef(ref, p)),
  );
}
