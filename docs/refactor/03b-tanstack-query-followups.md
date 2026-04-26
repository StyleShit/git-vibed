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

### 1. Path-routed read IPCs for the remaining endpoints

The tab-switch race fix (`8df7b67`) plumbed `repoPath` through eight read IPCs (`status`, `branches`, `log`, `remotes`, `stashList`, `tags`, `worktreeList`, `undoState`). The same pattern still has to be applied to:

- `ghApi.available` (used by `ghAvailableOptions`)
- `ghApi.prList` (used by `prsOptions`)
- `gitApi.mergeMessage` (`CommitPanel`)
- `gitApi.conflictKind` / `fileAtRef` / `findRenameTarget` (`MergeEditor`)
- `gitApi.stashShow` / `stashShowFiles` (`StashDetail`)
- `gitApi.commitFiles` (`CommitDetail`)
- `gitApi.diff` (`DiffViewer` / `WipFileDiff` / `CommitFileDiff`)
- `gitApi.configList` / `configGet` (`SettingsPanel`)

The race shape is identical: a bg refetch fires for tab 1, user switches to tab 2, response resolves against main's active session = tab 2, gets written into tab 1's cache key. Most of the above are either single-tab-context (the merge editor) or rarely refetched in the background, so users may not hit it — but it's the same correctness gap.

Pattern (already established in commit `8df7b67`):

1. `src-electron/preload.ts` — add `repoPath: string` as the first arg, pass through `invoke<T>(CHANNEL, repoPath, ...)`.
2. `src-electron/ipc/git-handlers.ts` — destructure as `(_e, repoPath: string, ...args)` and switch `exec(repo)` → `exec(repo, repoPath)`. The `exec` helper already accepts an optional path.
3. `src/queries/gitApi.ts` — query factories thread the path through:
   ```ts
   const p = path ?? "";
   queryFn: () => unwrap(window.gitApi.x(p, ...))
   ```
4. Any other call site (e.g. `CommitPanel` calls `gitApi.log` directly outside the query) needs the path too.

For `gh.*`: github operations talk to a network host, not the local repo. `gh` CLI does run with `cwd=repoPath`, so the same plumbing applies. Confirm by checking `src-electron/ipc/gh-handlers.ts`.

For mutations: deferred. Mutations are user-initiated. They run after `setActiveRepo` has flipped main's active key (because `setActive` awaits it before flipping `activeIdx`), so the race doesn't hit them. If you want defense-in-depth, extend the same pattern.

### 2. Detail-view queries (originally 03b in §7 of the execution plan)

Three read IPCs are still fetched ad-hoc inside `useEffect + useState`:

| Hook | queryKey | queryFn | staleTime | Callers |
| --- | --- | --- | --- | --- |
| `useCommitFiles(path, hash)` | `["repo", path, "commit-files", hash]` | `unwrap(gitApi.commitFiles(hash))` | `Infinity` | `CommitDetail.tsx` |
| `useWipDiff(path, args)` | `["repo", path, "diff", "wip", args]` | `unwrap(gitApi.diff(args))` | `0` | `WipFileDiff.tsx`, `DiffViewer.tsx` — invalidated by status watcher |
| `useCommitDiff(path, args)` | `["repo", path, "diff", "commit", args]` | `unwrap(gitApi.diff(args))` | `Infinity` | `CommitFileDiff.tsx` — immutable per commit range |
| `useStashShowFiles(path, index)` | `["repo", path, "stash-files", index]` | `unwrap(gitApi.stashShowFiles(index))` | `Infinity` | `StashDetail.tsx` |

Migrate each call site off the local `useState`. WIP diff is the only one whose key needs to be invalidated by anything (status mutations) — add it to `afterStashMutation` / staging mutation `onSuccess` lists if you want it to feel snappy. Otherwise the watcher's `index`/`worktree` event already invalidates `status`, and the WIP diff would be invalidated by a separate mechanism — easiest is to add `["repo", path, "diff", "wip"]` to `RepoEventBridge`'s `INDEX` list.

Tackle this AFTER (1), so the path-routing change applies cleanly.

### 3. Drop `repo.ts`'s `useShallow` import if `useActiveTabShallow` is no longer used

After the trim, `useActiveTabShallow` is only used in `Toolbar.tsx`, `StatusBar.tsx`, and inside `repo.ts` itself. The Toolbar + StatusBar usages are tiny `(t) => ({ path, behindRemote })` shapes — could become two separate selectors. Not blocking, just a tidy-up if you find yourself there.

### 4. Don't forget the `useUI` toast manager dance

`src/stores/ui.ts` still exposes `toastManager` (Base UI) plus a `toast(kind, text)` method on the zustand store. That's intentional and works. Mentioning so a fresh agent doesn't get confused by toast wiring while reading the stores.

### 5. Outstanding test gap

The three Step D acceptance tests envisioned by the plan (`stage → status updates`, `commit → log updates`, `checkout → branches update`) exist in `src/components/graph/ChangesPanel.browser.test.tsx`, `BranchGraph.browser.test.tsx`, and `stores/repo.browser.test.tsx`. They cover the invalidate → refetch → cache update path but not the **mutation** itself (they fire the watcher event after stubbing the post-state). A useful addition: a test per Step D domain that asserts `mutateAsync` actually fires the right `gitApi.*` call with the right args. The `__gitApiMock` helper has `expect(window.__gitApiMock.api.X).toHaveBeenCalledWith(...)`-style affordances; see `Toolbar.browser.test.tsx` for the existing pattern.

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
