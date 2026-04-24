import { type UseMutationOptions } from "@tanstack/react-query";
import { unwrap } from "../lib/ipc";
import { queryClient } from "./client";
import {
  gitBranchesOptions,
  gitLogOptions,
  gitRemotesOptions,
  gitStashesOptions,
  gitStatusOptions,
  gitTagsOptions,
  gitUndoOptions,
  gitWorktreesOptions,
} from "./gitApi";

// Invalidate a list of query keys in one go. Helper because every
// onSuccess invalidates one or more keys and the boilerplate adds up.
function invalidate(keys: readonly (readonly unknown[])[]) {
  for (const k of keys) queryClient.invalidateQueries({ queryKey: k });
}

// --- Staging -------------------------------------------------------------

export function stageMutation(
  path: string,
): UseMutationOptions<void, Error, string[]> {
  return {
    mutationFn: async (files) => {
      await unwrap(window.gitApi.stage(files));
    },
    onSuccess: () => invalidate([gitStatusOptions(path).queryKey]),
  };
}

export function unstageMutation(
  path: string,
): UseMutationOptions<void, Error, string[]> {
  return {
    mutationFn: async (files) => {
      await unwrap(window.gitApi.unstage(files));
    },
    onSuccess: () => invalidate([gitStatusOptions(path).queryKey]),
  };
}

export function discardMutation(
  path: string,
): UseMutationOptions<void, Error, string[]> {
  return {
    mutationFn: async (files) => {
      await unwrap(window.gitApi.discard(files));
    },
    onSuccess: () => invalidate([gitStatusOptions(path).queryKey]),
  };
}

export function stagePatchMutation(
  path: string,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (patch) => {
      await unwrap(window.gitApi.stagePatch(patch));
    },
    onSuccess: () => invalidate([gitStatusOptions(path).queryKey]),
  };
}

export function unstagePatchMutation(
  path: string,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (patch) => {
      await unwrap(window.gitApi.unstagePatch(patch));
    },
    onSuccess: () => invalidate([gitStatusOptions(path).queryKey]),
  };
}

export function discardPatchMutation(
  path: string,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (patch) => {
      await unwrap(window.gitApi.discardPatch(patch));
    },
    onSuccess: () => invalidate([gitStatusOptions(path).queryKey]),
  };
}

export function markResolvedMutation(
  path: string,
): UseMutationOptions<void, Error, string[]> {
  return {
    mutationFn: async (files) => {
      await unwrap(window.gitApi.markResolved(files));
    },
    onSuccess: () => invalidate([gitStatusOptions(path).queryKey]),
  };
}

// --- Stashes -------------------------------------------------------------

type StashInput = { message?: string; files?: string[] } | string | undefined;

function afterStashMutation(path: string) {
  // Every stash mutation moves both the WIP state (status) and the stash
  // list; stashPop/stashApply can also surface new WIP files from the
  // stash, which changes the working tree.
  invalidate([
    gitStatusOptions(path).queryKey,
    gitStashesOptions(path).queryKey,
    gitLogOptions(path).queryKey,
  ]);
}

export function stashCreateMutation(
  path: string,
): UseMutationOptions<void, Error, StashInput> {
  return {
    mutationFn: async (input) => {
      await unwrap(window.gitApi.stash(input));
    },
    onSuccess: () => afterStashMutation(path),
  };
}

export function stashPopMutation(
  path: string,
): UseMutationOptions<void, Error, void> {
  return {
    mutationFn: async () => {
      await unwrap(window.gitApi.stashPop());
    },
    onSuccess: () => afterStashMutation(path),
  };
}

export function stashApplyMutation(
  path: string,
): UseMutationOptions<void, Error, number> {
  return {
    mutationFn: async (index) => {
      await unwrap(window.gitApi.stashApply(index));
    },
    onSuccess: () => afterStashMutation(path),
  };
}

export function stashDropMutation(
  path: string,
): UseMutationOptions<void, Error, number> {
  return {
    mutationFn: async (index) => {
      await unwrap(window.gitApi.stashDrop(index));
    },
    onSuccess: () => afterStashMutation(path),
  };
}

// --- Tags ----------------------------------------------------------------

interface TagCreateInput {
  name: string;
  ref: string;
  message?: string;
}

export function tagCreateMutation(
  path: string,
): UseMutationOptions<void, Error, TagCreateInput> {
  return {
    mutationFn: async ({ name, ref, message }) => {
      await unwrap(window.gitApi.tagCreate(name, ref, message));
    },
    onSuccess: () =>
      invalidate([gitTagsOptions(path).queryKey, gitLogOptions(path).queryKey]),
  };
}

export function tagDeleteMutation(
  path: string,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (name) => {
      await unwrap(window.gitApi.tagDelete(name));
    },
    onSuccess: () =>
      invalidate([gitTagsOptions(path).queryKey, gitLogOptions(path).queryKey]),
  };
}

// --- Remotes -------------------------------------------------------------

interface RemoteAddInput {
  name: string;
  url: string;
}

interface RemoteSetUrlInput {
  name: string;
  url: string;
  push?: boolean;
}

export function remoteAddMutation(
  path: string,
): UseMutationOptions<void, Error, RemoteAddInput> {
  return {
    mutationFn: async ({ name, url }) => {
      await unwrap(window.gitApi.remoteAdd(name, url));
    },
    onSuccess: () => invalidate([gitRemotesOptions(path).queryKey]),
  };
}

export function remoteRemoveMutation(
  path: string,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (name) => {
      await unwrap(window.gitApi.remoteRemove(name));
    },
    onSuccess: () => invalidate([gitRemotesOptions(path).queryKey]),
  };
}

export function remoteSetUrlMutation(
  path: string,
): UseMutationOptions<void, Error, RemoteSetUrlInput> {
  return {
    mutationFn: async ({ name, url, push }) => {
      await unwrap(window.gitApi.remoteSetUrl(name, url, push));
    },
    onSuccess: () => invalidate([gitRemotesOptions(path).queryKey]),
  };
}

// --- Worktrees -----------------------------------------------------------

interface WorktreeAddInput {
  path: string;
  branch: string;
  createBranch?: boolean;
}

interface WorktreeRemoveInput {
  path: string;
  force?: boolean;
}

interface WorktreeLockInput {
  path: string;
  reason?: string;
}

export function worktreeAddMutation(
  path: string,
): UseMutationOptions<void, Error, WorktreeAddInput> {
  return {
    mutationFn: async ({ path: wtPath, branch, createBranch }) => {
      await unwrap(window.gitApi.worktreeAdd(wtPath, branch, createBranch));
    },
    onSuccess: () =>
      invalidate([
        gitWorktreesOptions(path).queryKey,
        gitBranchesOptions(path).queryKey,
      ]),
  };
}

export function worktreeRemoveMutation(
  path: string,
): UseMutationOptions<void, Error, WorktreeRemoveInput> {
  return {
    mutationFn: async ({ path: wtPath, force }) => {
      await unwrap(window.gitApi.worktreeRemove(wtPath, force));
    },
    onSuccess: () => invalidate([gitWorktreesOptions(path).queryKey]),
  };
}

export function worktreeLockMutation(
  path: string,
): UseMutationOptions<void, Error, WorktreeLockInput> {
  return {
    mutationFn: async ({ path: wtPath, reason }) => {
      await unwrap(window.gitApi.worktreeLock(wtPath, reason));
    },
    onSuccess: () => invalidate([gitWorktreesOptions(path).queryKey]),
  };
}

export function worktreeUnlockMutation(
  path: string,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (wtPath) => {
      await unwrap(window.gitApi.worktreeUnlock(wtPath));
    },
    onSuccess: () => invalidate([gitWorktreesOptions(path).queryKey]),
  };
}

// --- Branches ------------------------------------------------------------

interface BranchCreateInput {
  name: string;
  base?: string;
}

interface BranchRenameInput {
  oldName: string;
  newName: string;
}

interface BranchDeleteInput {
  name: string;
  force?: boolean;
}

interface BranchSetUpstreamInput {
  branch: string;
  upstream: string | null;
}

function afterBranchIdentityChange(path: string) {
  // Create / rename / delete / upstream all change the ref namespace.
  // Log can change (new branch tip, or a detached-head commit now lives
  // under a ref name); status includes the current branch name.
  invalidate([
    gitBranchesOptions(path).queryKey,
    gitLogOptions(path).queryKey,
    gitStatusOptions(path).queryKey,
  ]);
}

export function branchCreateMutation(
  path: string,
): UseMutationOptions<void, Error, BranchCreateInput> {
  return {
    mutationFn: async ({ name, base }) => {
      await unwrap(window.gitApi.branchCreate(name, base));
    },
    onSuccess: () => afterBranchIdentityChange(path),
  };
}

export function branchRenameMutation(
  path: string,
): UseMutationOptions<void, Error, BranchRenameInput> {
  return {
    mutationFn: async ({ oldName, newName }) => {
      await unwrap(window.gitApi.branchRename(oldName, newName));
    },
    onSuccess: () => afterBranchIdentityChange(path),
  };
}

export function branchDeleteMutation(
  path: string,
): UseMutationOptions<void, Error, BranchDeleteInput> {
  return {
    mutationFn: async ({ name, force }) => {
      await unwrap(window.gitApi.branchDelete(name, force));
    },
    onSuccess: () => afterBranchIdentityChange(path),
  };
}

export function branchSetUpstreamMutation(
  path: string,
): UseMutationOptions<void, Error, BranchSetUpstreamInput> {
  return {
    mutationFn: async ({ branch, upstream }) => {
      await unwrap(window.gitApi.branchSetUpstream(branch, upstream));
    },
    onSuccess: () =>
      invalidate([
        gitBranchesOptions(path).queryKey,
        gitStatusOptions(path).queryKey,
      ]),
  };
}

// --- History ops ---------------------------------------------------------

// Anything that moves HEAD touches status, branches, log, undo, and
// possibly worktrees (git stores per-worktree HEAD tips). One helper for
// the full fan-out.
function afterHeadMove(path: string) {
  invalidate([
    gitStatusOptions(path).queryKey,
    gitBranchesOptions(path).queryKey,
    gitLogOptions(path).queryKey,
    gitUndoOptions(path).queryKey,
    gitWorktreesOptions(path).queryKey,
  ]);
}

export function checkoutMutation(
  path: string,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (target) => {
      await unwrap(window.gitApi.checkout(target));
    },
    onSuccess: () => afterHeadMove(path),
  };
}

interface CheckoutCreateInput {
  name: string;
  startPoint: string;
}

export function checkoutCreateMutation(
  path: string,
): UseMutationOptions<void, Error, CheckoutCreateInput> {
  return {
    mutationFn: async ({ name, startPoint }) => {
      await unwrap(window.gitApi.checkoutCreate(name, startPoint));
    },
    onSuccess: () => afterHeadMove(path),
  };
}

export function cherryPickMutation(
  path: string,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (hash) => {
      await unwrap(window.gitApi.cherryPick(hash));
    },
    onSuccess: () => afterHeadMove(path),
  };
}

export function revertMutation(
  path: string,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: async (hash) => {
      await unwrap(window.gitApi.revert(hash));
    },
    onSuccess: () => afterHeadMove(path),
  };
}

interface ResetInput {
  target: string;
  mode: "soft" | "mixed" | "hard";
}

export function resetMutation(
  path: string,
): UseMutationOptions<void, Error, ResetInput> {
  return {
    mutationFn: async ({ target, mode }) => {
      await unwrap(window.gitApi.reset(target, mode));
    },
    onSuccess: () => afterHeadMove(path),
  };
}

export function undoHeadMutation(
  path: string,
): UseMutationOptions<{ label: string | null }, Error, void> {
  return {
    mutationFn: async () => unwrap(window.gitApi.undoHead()),
    onSuccess: () => afterHeadMove(path),
  };
}

export function redoHeadMutation(
  path: string,
): UseMutationOptions<{ label: string | null }, Error, void> {
  return {
    mutationFn: async () => unwrap(window.gitApi.redoHead()),
    onSuccess: () => afterHeadMove(path),
  };
}

// --- Remote sync (pull / push / fetch) -----------------------------------

// Remote sync rarely changes what's staged, but it does shift HEAD + refs
// and can update the tag namespace. Reuse afterHeadMove and add tags.
function afterRemoteSync(path: string) {
  invalidate([
    gitStatusOptions(path).queryKey,
    gitBranchesOptions(path).queryKey,
    gitLogOptions(path).queryKey,
    gitTagsOptions(path).queryKey,
    gitUndoOptions(path).queryKey,
  ]);
}

type PullOpts = import("@shared/types").PullOptions;
type PushOpts = import("@shared/types").PushOptions;
type FetchOpts = import("@shared/types").FetchOptions;

export function pullMutation(
  path: string,
): UseMutationOptions<string, Error, PullOpts> {
  return {
    mutationFn: async (opts) => unwrap(window.gitApi.pull(opts)),
    onSuccess: () => afterRemoteSync(path),
  };
}

export function pushMutation(
  path: string,
): UseMutationOptions<string, Error, PushOpts> {
  return {
    mutationFn: async (opts) => unwrap(window.gitApi.push(opts)),
    onSuccess: () => afterRemoteSync(path),
  };
}

export function fetchMutation(
  path: string,
): UseMutationOptions<string, Error, FetchOpts> {
  return {
    mutationFn: async (opts) => unwrap(window.gitApi.fetch(opts)),
    onSuccess: () => afterRemoteSync(path),
  };
}

export function pullBranchMutation(
  path: string,
): UseMutationOptions<string, Error, string> {
  return {
    mutationFn: async (branch) => unwrap(window.gitApi.pullBranch(branch)),
    onSuccess: () => afterRemoteSync(path),
  };
}

interface PushBranchInput {
  branch: string;
  force?: boolean;
}

export function pushBranchMutation(
  path: string,
): UseMutationOptions<string, Error, PushBranchInput> {
  return {
    mutationFn: async ({ branch, force }) =>
      unwrap(window.gitApi.pushBranch(branch, force)),
    onSuccess: () => afterRemoteSync(path),
  };
}
