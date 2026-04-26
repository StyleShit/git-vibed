# Task 03b — TanStack Query follow-ups

> **Prerequisite:** read `00-shared-context.md`, then skim `03a-tanstack-query-execution.md` (the plan that drove the main migration). Task 03a is **Done** as of commit `65556de`. This file lists what was deliberately deferred plus a couple of items discovered during execution.

## State as of handoff

- Every consumer reads server-state via `queryOptions` factories in `src/queries/gitApi.ts` (`useQuery` / `useInfiniteQuery` / `useQueries`).
- Every mutation goes through `useMutation(factoryMutation(path))` from `src/queries/mutations.ts`. Each `onSuccess` invalidates targeted query keys and **returns** the joined `invalidateQueries` promise so `await mutateAsync(...)` blocks until refetches land (this is load-bearing — the merge-resolve race depends on it).
- `src/queries/RepoEventBridge.tsx` translates `REPO_CHANGED` watcher events + `onFetchComplete(changed: true)` into `queryClient.invalidateQueries`. It's the *only* path the watcher uses. Mounted once from `src/main.tsx` inside `<QueryClientProvider>`.
- `src/stores/repo.ts` is now ~150 lines: `tabs[]: { path, behindRemote, backgroundFetching }` + `openRepo / closeTab / setActive / setBehindRemote / setBackgroundFetching`. No git data; no `refresh*`; no `patchTab`; no `loadMoreCommits`.
- `src/App.tsx` keeps the `onFetchStart` / `onFetchComplete` listeners only for the spinner + behind-remote badge (zustand UI state). The 5s focus poll is gone — `gitStatusOptions` carries `refetchInterval: 5000` + `refetchIntervalInBackground: false` + `refetchOnWindowFocus: true`.
- 49 vitest tests pass. Browser tests render a tiny query subscriber when they need an invalidate to actually refetch (default `refetchType: 'active'`).
- `pnpm typecheck`, `pnpm test:run`, manual click-through across stage / unstage / commit / stash / branch ops / pull / push / fetch / merge-with-conflicts all clean.

## Follow-ups, in priority order

### 1. Path-routed read IPCs for the remaining endpoints — **Done**

The tab-switch race fix (`8df7b67`) plumbed `repoPath` through eight read IPCs (`status`, `branches`, `log`, `remotes`, `stashList`, `tags`, `worktreeList`, `undoState`). The same pattern has now been applied to the remaining read endpoints:

- `ghApi.available` / `ghApi.prList` — `GhExecutor.available`/`prList` accept an optional `cwd` and the handlers thread `repoPath` through.
- `gitApi.mergeMessage` (`CommitPanel`)
- `gitApi.conflictKind` / `fileAtRef` / `findRenameTarget` (`MergeEditor`)
- `gitApi.stashShow` / `stashShowFiles` (`StashDetail`, `StashFileDiff`)
- `gitApi.commitFiles` (`CommitDetail`)
- `gitApi.diff` (`WipFileDiff`, `CommitFileDiff`)
- `gitApi.configList` / `configGet` (`SettingsPanel`)

Mutations remain deferred — they run after `setActiveRepo` has flipped main's active key, so the race doesn't hit them. The unchanged write IPCs (`writeFile`, `resolveWithSide`, `resolveWithDelete`, `configSet`, etc.) still route through the active session.

Pattern reference (established in commit `8df7b67`):

1. `src-electron/preload.ts` — add `repoPath: string` as the first arg, pass through `invoke<T>(CHANNEL, repoPath, ...)`.
2. `src-electron/ipc/git-handlers.ts` — destructure as `(_e, repoPath: string, ...args)` and switch `exec(repo)` → `exec(repo, repoPath)`. The `exec` helper already accepts an optional path.
3. `src/queries/gitApi.ts` — query factories thread the path through:
   ```ts
   const p = path ?? "";
   queryFn: () => unwrap(window.gitApi.x(p, ...))
   ```
4. Any other call site (e.g. `CommitPanel` calls `gitApi.log` directly outside the query) needs the path too.

### 2. Detail-view queries (originally 03b in §7 of the execution plan) — **Done**

The four detail-view reads now live in `src/queries/gitApi.ts` and call sites use `useQuery`:

| Factory | queryKey | staleTime | Caller |
| --- | --- | --- | --- |
| `commitFilesOptions(path, hash)` | `["repo", path, "commit-files", hash]` | `Infinity` | `CommitDetail.tsx` |
| `wipDiffOptions(path, file, staged)` | `["repo", path, "diff", "wip", file, staged]` | `0` | `WipFileDiff.tsx` |
| `commitDiffOptions(path, hash, file)` | `["repo", path, "diff", "commit", hash, file]` | `Infinity` | `CommitFileDiff.tsx` |
| `stashFilesOptions(path, index)` | `["repo", path, "stash-files", index]` | `Infinity` | `StashDetail.tsx`, `StashFileDiff.tsx` |

All four use `placeholderData: keepPreviousData` so switching files/commits/stashes shows the previous data during the fetch instead of flashing "Loading…" — that's how the original `useEffect + useState` versions felt.

Invalidation wiring:
- `RepoEventBridge` INDEX bucket invalidates `["repo", path, "diff", "wip"]` so watcher index/worktree events refresh the open WIP diff.
- Staging / discard / mark-resolved / writeFile / resolveWith\* mutations invalidate `wipDiffPrefix(path)` in their `onSuccess` so the diff refreshes the moment the mutation lands (no waiting for the watcher).
- `afterStashMutation` invalidates both `wipDiffPrefix(path)` (pop/apply surface new WIP files) and `stashFilesPrefix(path)` (drop shifts indexes — the cached files for stash@{0} are no longer the same stash).

`RepoEventBridge`'s old `QueryKind` enum is now `KeySuffix[]` so multi-segment suffixes can sit alongside single-segment ones in the same bucket.

### 3. Drop `repo.ts`'s `useShallow` import — **Done**

`useActiveTabShallow` and the `useShallow` import are gone. Replacements:

- `useActivePath()` — primitive return (`string | null`), default identity equality is enough; no `useShallow` needed. Use this any time you only want the path.
- For multi-field reads (`StatusBar` wanted `{ path, behindRemote }`, `Toolbar` wanted `{ path, backgroundFetching }`) the call sites now use two separate selectors. Cheaper than a shallow-equality picker for a 2-field shape.

### 4. Don't forget the `useUI` toast manager dance

`src/stores/ui.ts` still exposes `toastManager` (Base UI) plus a `toast(kind, text)` method on the zustand store. That's intentional and works. Mentioning so a fresh agent doesn't get confused by toast wiring while reading the stores.

### 5. Mutation acceptance tests — **Done**

`src/queries/mutations.browser.test.tsx` covers the three Step D domains via a tiny `MutationProbe` that mounts a `useMutation`, fires `mutateAsync` once, and asserts `window.__gitApiMock.api.X` was called with the expected input:

- `stageMutation` → `gitApi.stage(files)`
- `commitMutation` → `gitApi.commit(opts)`
- `checkoutMutation` → `gitApi.checkout(branch)`

The probe avoids walking through the UI's per-domain enabling logic (`canCommit`, branch dropdown, etc.) so the test stays focused on the mutation→IPC wiring. The inverse leg (REPO_CHANGED → cache refetch) remains covered in `ChangesPanel.browser.test.tsx`, `BranchGraph.browser.test.tsx`, and `stores/repo.browser.test.tsx`.

## How to verify each follow-up

- After (1): rapidly switch between two open tabs while a background refetch is in flight. Expect each tab's panels to keep showing that tab's data; the React Query devtools should show distinct cache entries for `["repo", "/tab1/path", X]` and `["repo", "/tab2/path", X]`.
- After (2): open a commit in `CommitDetail`, switch tabs, switch back — files list shouldn't flash empty (cached). Open a stash detail; same. Edit a file, see WIP diff update without manual refresh.

## Where things live

- Plan: `docs/refactor/03a-tanstack-query-execution.md` (the long one).
- Hooks: `src/queries/gitApi.ts` (factories), `src/queries/mutations.ts`, `src/queries/RepoEventBridge.tsx`, `src/queries/client.ts`.
- Store: `src/stores/repo.ts`.
- Test harness: `src/test/setup.ts`, `src/test/renderWithRepo.tsx`, `src/test/gitApi-mock.ts`.

## Commits worth knowing

| Commit | Why you might revisit |
| --- | --- |
| `8df7b67` | Read-IPC path routing — pattern for follow-up #1 |
| `c511913` | Mutation `invalidate()` returns the joined promise — load-bearing for the merge-resolve race fix |
| `4710453` | Bridges in `repo.ts` — already gone after Step E but the message has good context |
| `0f8c6bc` | Step E cleanup — what survived the trim |
| `65556de` | Marks 03a Done |
