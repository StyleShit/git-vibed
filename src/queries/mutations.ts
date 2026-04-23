import { type UseMutationOptions } from "@tanstack/react-query";
import { unwrap } from "../lib/ipc";
import { queryClient } from "./client";
import { gitStatusOptions } from "./gitApi";

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
