# Task 03a — TanStack Query migration: execution plan

> **This file is the output of Task 03.** Numbered `03a` because `04` is already taken by `04-decompose-merge-editor.md`. It is safe to delegate each step (A–F) to a separate agent as an independent PR. Read `00-shared-context.md` and the relevant section of this file before starting a step.

## Discrepancies with shared-context / task 03

- `00-shared-context.md` and `03-tanstack-query-plan.md` both describe the watcher payload as `head | index | refs | merge`. The **actual** type (verified in `src/shared/types.ts:263` and `src-electron/git/watcher.ts:62-68`) is:
  ```ts
  interface RepoChangedEvent { repoPath: string; type: "index" | "head" | "refs" | "worktree" }
  ```
  There is no `merge` kind. `MERGE_HEAD` / `rebase-merge` / `rebase-apply` changes are classified as `"worktree"` by `watcher.ts:67`. This plan uses the real schema.
- The App.tsx listener currently treats `"index"` and `"worktree"` as one bucket (refresh status + stashes). Preserve that on migration.
- Watcher skips `refs/remotes/**` (EMFILE guard), so fetch completion is driven by the `FETCH_COMPLETE` event separately — that path invalidates `branches + log + tags + status` in `App.tsx:115-120`. It stays separate from `REPO_CHANGED`.

## Dependency to add

```
pnpm add @tanstack/react-query
pnpm add -D @tanstack/react-query-devtools
```
No other deps.

---

## 1. Query hook inventory

All keys start with `["repo", repoPath]` so tab switches are free (each tab is a distinct cache). Hooks live in `src/queries/*.ts`.

| Hook | queryKey | queryFn | staleTime | gcTime | Notes |
| --- | --- | --- | --- | --- | --- |
| `useGitStatus(path)` | `["repo", path, "status"]` | `unwrap(gitApi.status())` | `0` | `5m` | Invalidated on every mutation + watcher `index`/`worktree`/`head`. Polled by focus fallback. |
| `useGitBranches(path)` | `["repo", path, "branches"]` | `unwrap(gitApi.branches())` | `30s` | `5m` | |
| `useGitLog(path)` | `["repo", path, "log"]` | `unwrap(gitApi.log({ all:true, limit, skip }))` | `30s` | `5m` | **`useInfiniteQuery`**. `getNextPageParam = pages => lastPage.length < LOG_PAGE_SIZE ? undefined : totalLoaded` (replaces the manual `commitsExhausted` + `loadingMoreCommits` flags). `LOG_PAGE_SIZE = 500` unchanged. |
| `useGitRemotes(path)` | `["repo", path, "remotes"]` | `unwrap(gitApi.remotes())` | `5m` | `10m` | |
| `useGitStashes(path)` | `["repo", path, "stashes"]` | `unwrap(gitApi.stashList())` | `30s` | `5m` | |
| `useGitTags(path)` | `["repo", path, "tags"]` | `unwrap(gitApi.tags())` | `1m` | `5m` | |
| `useGitWorktrees(path)` | `["repo", path, "worktrees"]` | `unwrap(gitApi.worktreeList())` | `1m` | `5m` | |
| `useGitUndo(path)` | `["repo", path, "undo"]` | `unwrap(gitApi.undoState())` | `0` | `5m` | Tiny payload; drives toolbar undo/redo enabled state. |
| `usePRs(path)` | `["repo", path, "prs", prStateFilter]` | `ghAvailable && ghApi.prList(prStateFilter)` | `2m` | `10m` | Keyed on the settings `prStateFilter` so changing the filter busts the key cleanly. Disabled when `!ghAvailable`. |
| `useGhAvailable(path)` | `["repo", path, "ghAvailable"]` | `maybe(ghApi.available())` | `Infinity` | `Infinity` | Per-repo. Fetched once on tab open; won't change mid-session. Replaces today's zustand-pinned `ghAvailable` field — first render sees `undefined`; existing callers already use `?? false` so the grace period renders as "not available" until it resolves. |

> `useCommitFiles`, `useFileDiff`, `useStashShowFiles` are **deferred** to a follow-up (see §7). They're read-only detail views already fetched in local `useEffect + useState`; converting them is pure cleanup and not on the critical path to replacing `refreshAll`.

**Not server-state — stays in zustand** (see §4):
- `behindRemote` (driven by `FETCH_COMPLETE` event, not git state).
- `backgroundFetching` (spinner flag driven by `FETCH_START`/`FETCH_COMPLETE`).
- `loading` (boot-time "loading first payload" flag — redundant with TQ `isPending`; delete after migration).

**Read sites (current) that become hook swaps:**

| Field | Current call sites |
| --- | --- |
| `status` | `CommitPanel:8`, `StagingArea:13`, `BranchGraph:52`, `MergeRebaseDialog:16`, `ConflictList:9`, `MergeEditor:63`, `CommitDetail:29`, `MainPanel:15`, `Toolbar:29` (shallow), `StatusBar:7` (shallow), `TagCreateDialog` (shallow), `PRCreateDialog` (shallow), `BranchCreateDialog` (shallow), `ChangesPanel:27` (shallow), `TabBar:18` (full `useActiveTab`) |
| `branches` | `BranchGraph:723`, `BranchList:44`, `BranchContextMenu` (shallow via `refreshAll`), `Sidebar:37` (shallow), `Toolbar:29` (shallow), `TagCreateDialog`, `PRCreateDialog`, `BranchCreateDialog`, `WorktreeAddDialog` (shallow) |
| `commits` | `BranchGraph:51`, `CommitDetail:27`, `MainPanel:17`, `Sidebar:37` (shallow) |
| `remotes` | `BranchGraph:593,724`, `BranchList:45`, `BranchContextMenu:37`, `RemoteList:5`, `RemotesPanel:10` |
| `prs` | `PRList:8`, `BranchContextMenu:38`, `CommitDetail:28`, `StatusBar:7` (shallow) |
| `stashes` | `StashList:11`, `StashDetail:23`, `StashContextMenu:28`, `Sidebar:37` (shallow) |
| `tags` | `TagList:10`, `Sidebar:37` (shallow) |
| `worktrees` | `WorktreeList:10`, `Sidebar:37` (shallow), `ChangesPanel:27` (shallow) |
| `undo` | `Toolbar:29` (shallow) |
| `ghAvailable` | `BranchContextMenu:36`, `StatusBar:7` (shallow) |
| `commitsExhausted`, `loadingMoreCommits` | `BranchGraph:346,347` — these **disappear** with `useInfiniteQuery`. |
| `loading` | `MainPanel:16` — delete, use `useGitStatus(...).isPending`. |

---

## 2. Mutation inventory

All mutations below are `useMutation`s whose `onSuccess` invalidates specific keys. Default `onSuccess` is defined via a shared helper so every call site doesn't repeat the list. Prefer narrow invalidation; `refreshAll`'s current shotgun is wasteful.

Shared helper (lives in `src/queries/index.ts`):
```ts
export function invalidateKeys(qc: QueryClient, path: string, kinds: QueryKind[]) {
  for (const k of kinds) qc.invalidateQueries({ queryKey: ["repo", path, k] });
}
```

### Staging

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `ChangesPanel:114` | `stage(paths)` | `status` |
| `ChangesPanel:119` | `unstage(paths)` | `status` |
| `StagingArea:22,31,47` | `stage / unstage / discard` | `status` |
| `DiffViewer:52,53,79,80` | `stagePatch / unstagePatch` | `status` |
| `WipFileDiff:144,147,167,191,194,225` | `stagePatch / unstagePatch / discardPatch` | `status` |
| `ChangesPanel:131` | `discard(paths)` | `status` |

### Commit

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `CommitPanel:141` | `commit(opts)` | `status, branches, log, undo, worktrees` (head moved) |

### History ops (reset / checkout / cherry-pick / revert / undo / redo)

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `CommitContextMenu:36,52,72,82` | `cherryPick / revert / reset / checkout` | `status, branches, log, undo, worktrees` |
| `Toolbar:143,157` | `undoHead / redoHead` | same |
| `BranchContextMenu:156` | `reset` | same |
| `BranchGraph:781,793,812,827,835,999` | `checkout / checkoutCreate / reset / branchRename` | same + `tags` for branch-rename |
| `BranchList:101,114,192,268` | `checkout / branchRename / branchDelete / merge` | same |

### Branches

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `BranchCreateDialog:31,32,34` | `branchCreate / checkout` | `branches, status, log, undo` |
| `BranchContextMenu:125,136` | `branchSetUpstream` | `branches, status` |

### Remote sync (pull / push / fetch / pullBranch / pushBranch)

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `Toolbar:58,84,103` | `pull / push / fetch` | `status, branches, log, tags, undo` |
| `CommandPalette:106,123,140` | same | same |
| `BranchList:125,162,323` | `pullBranch / fetch(remote)` | same |
| `BranchContextMenu:78,95` | `pullBranch / pushBranch` | same |

### Stashes

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `Toolbar:116,129` | `stash / stashPop` | `stashes, status, log` |
| `ChangesPanel:142` | `stash({files})` | `stashes, status` |
| `StashList:32-56`, `StashDetail:142-185`, `StashContextMenu:63-95` | `stashApply / stashPop / stashDrop` | `stashes, status, log` |
| `CommandPalette:162,178,248` | `stash / stashPop / stashApply` | same |

### Tags

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `TagCreateDialog:34` | `tagCreate` | `tags, log` |
| `TagList:34` | `tagDelete` | `tags, log` |

### Remotes

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `RemotesPanel:26,102,156,159` | `remoteAdd / remoteRemove / remoteSetUrl` | `remotes, status, prs` (url affects PR host) |
| `AddRemoteDialog:28,32`, `EditRemoteDialog:39,42` | same | same |

### Worktrees

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `WorktreeList:48,62,65` | `worktreeRemove / worktreeLock / worktreeUnlock` | `worktrees` |
| `WorktreeAddDialog:59,72,73` | `worktreeAdd / branchCreate` | `worktrees, branches` |

### Merge / rebase

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `MergeRebaseDialog:27,28` | `merge / rebase` | `status, branches, log, undo, worktrees` |
| `ConflictList:49,67,68,80` | `rebaseContinue / mergeAbort / rebaseAbort / rebaseSkip` | same |
| `MainPanel:95,96` | `mergeAbort / rebaseAbort` | same |
| `MergeEditor:491,492,588,590,592` | `writeFile / markResolved / resolveWithSide / resolveWithDelete` | `status` |

### Config

| Call site | gitApi | Invalidate |
| --- | --- | --- |
| `SettingsPanel:173` | `configSet` | none (configList is its own local query) |

### PRs

| Call site | gh/gitApi | Invalidate |
| --- | --- | --- |
| `PRCreateDialog` | `ghApi.prCreate` | `prs` |
| `PRDetail` (merge / review) | `ghApi.prMerge / prReview` | `prs, branches, log, status` |

---

## 3. Watcher wiring — replaces App.tsx:55-131

Replace the imperative fan-out with a single event → invalidate call:

```ts
// src/queries/watcher-bridge.tsx
export function RepoEventBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    const off = window.gitApi.onRepoChanged(({ repoPath, type }) => {
      const kinds: QueryKind[] =
        type === "index" || type === "worktree"
          ? ["status", "stashes"]
          : type === "head"
            ? ["status", "branches", "log", "worktrees", "undo"]
            : /* refs */ ["branches", "log", "tags"];
      for (const k of kinds) qc.invalidateQueries({ queryKey: ["repo", repoPath, k] });
    });
    return () => { off(); };
  }, [qc]);
  return null;
}
```

Fetch lifecycle stays mostly as-is but drops the `set*` calls on useRepo in favour of a tiny zustand slice (see §4). The `if (e.changed)` post-fetch refresh becomes:
```ts
qc.invalidateQueries({ queryKey: ["repo", e.repoPath, "branches"] });
qc.invalidateQueries({ queryKey: ["repo", e.repoPath, "log"] });
qc.invalidateQueries({ queryKey: ["repo", e.repoPath, "tags"] });
qc.invalidateQueries({ queryKey: ["repo", e.repoPath, "status"] });
```

Work-tree polling (App.tsx:177-195) becomes a 5s `refetchInterval` on `useGitStatus` gated by `document.visibilityState === "visible"` — or kept as an imperative invalidate if simpler (the current shape is already correct; just swap the body).

**Verification check-list (do NOT skip):**
- head currently invalidates: `status, branches, log, worktrees, undo` ✓ (matches App.tsx:73-79)
- index currently invalidates: `status, stashes` ✓
- worktree currently invalidates: `status, stashes` ✓ (same bucket as index)
- refs currently invalidates: `branches, log, tags` ✓

---

## 4. Zustand trim — final `src/stores/repo.ts`

After Step F the store collapses to tab identity + ephemeral UI:

```ts
interface TabIdentity {
  path: string;           // primary key
  behindRemote: number;   // driven by onFetchComplete (not git state)
  backgroundFetching: boolean; // driven by onFetchStart/Complete
}

interface RepoState {
  tabs: TabIdentity[];
  activeIdx: number;
  openRepo(path: string): Promise<void>;
  closeTab(path: string): Promise<void>;
  setActive(idx: number): Promise<void>;
  setBehindRemote(path: string, v: number): void;
  setBackgroundFetching(path: string, v: boolean): void;
}
```

**Removed:** every `refreshX`, `patchTab`, `loadMoreCommits`, `refreshAll`, plus these fields: `status, branches, commits, commitsExhausted, loadingMoreCommits, remotes, prs, stashes, tags, worktrees, undo, loading, ghAvailable`.

`useActive` / `useActiveTab` / `useActiveTabShallow` **stay** but only read from the trimmed shape — they're handy for reading `path` + the three remaining UI-state fields. Rename to `useActiveRepoPath()` / `useActiveTabIdentity()` if confusing after migration.

**`ghAvailable` is not kept in zustand** — it becomes `useGhAvailable(path)` with `staleTime: Infinity`, loaded lazily the first time a consumer mounts. `openRepo` no longer awaits `ghApi.available()`; the `TabIdentity` above reflects that. Existing callers already default to `false` when missing, so the query's brief `undefined` window renders safely.

Session persistence (`queueSessionWrite`) stays identical — it only reads `tabs[].path` + `activeIdx`.

---

## 5. Migration order (one PR per step)

Each step ends with: typecheck passes, the listed manual click-through succeeds, existing Vitest suite stays green.

### Step A — Scaffold (low risk)
1. Install deps (`@tanstack/react-query`, devtools).
2. Create `src/queries/client.ts` — default `QueryClient` with `retry: false` (IPC errors aren't retryable in a useful way), `refetchOnWindowFocus: true` for status-like keys, `refetchOnReconnect: false`.
3. Wrap `<App>` in `<QueryClientProvider>` in `src/main.tsx`. Add `<ReactQueryDevtools>` behind an env flag.
4. Add `src/queries/gitApi.ts` with `useGitStatus` only.
5. Pick **one** consumer — `MainPanel.tsx` or `TabBar.tsx` — to swap to the new hook. Existing `useRepo` path keeps working alongside; this proves the Provider is reachable and the query runs.
6. **Acceptance**: open a repo → Status bar still shows current branch; devtools shows `["repo", path, "status"]` as "fresh". Close tab / reopen → cache reuse; no duplicate fetch.

### Step B — Add every read hook, keep zustand mirrors (low risk)
1. Add all hooks from §1 to `src/queries/gitApi.ts`. Each one's `queryFn` just wraps an existing `gitApi.*`. **Do not remove** any `useActive` call site yet.
2. Add `RepoEventBridge` (from §3) rendered alongside (not replacing) the current listener in `App.tsx`. **Both run concurrently** — zustand refreshes + TQ invalidations both fire. This is intentional: the old store keeps the UI correct while TQ warms up.
3. **Acceptance**: open devtools query panel, perform each action (stage, commit, push, stash, branch create, etc.). Every hook from §1 should show fresh → stale → refetched transitions. Zero UI regression (old store still drives the UI).

### Step C — Switch consumers from `useActive` to query hooks (medium risk)
Do one file at a time (there are ~25 of them). For each file:
1. Replace `useActive("X")` with `useGitX(activePath)` reading `data ?? fallback`.
2. Replace `useActiveTabShallow(picker)` with multiple hook calls or a local `useMemo` joining them.
3. Drop now-dead shallow pickers.
4. Verify typecheck + manual click-through of that component.

Suggested order (smallest blast radius first):
1. `StatusBar.tsx` — 4 fields.
2. `TagList.tsx`, `RemoteList.tsx`, `PRList.tsx`, `StashList.tsx` — single-field.
3. `WorktreeList.tsx`, `RemotesPanel.tsx` — single-field.
4. `BranchList.tsx`, `BranchContextMenu.tsx`, `StashContextMenu.tsx`, `StashDetail.tsx`.
5. `MergeRebaseDialog.tsx`, `ConflictList.tsx`, `MergeEditor.tsx`.
6. `CommitPanel.tsx`, `CommitDetail.tsx`, `StagingArea.tsx`, `ChangesPanel.tsx`.
7. `CommandPalette.tsx` — 7 fields at once.
8. `BranchGraph.tsx` — largest; log becomes `useInfiniteQuery`, `loadMoreCommits` collapses to `fetchNextPage()`.
9. `Toolbar.tsx` — 5-field shallow picker → split into `useGitStatus` + `useGitBranches` + `useGitUndo` + zustand `path` + zustand `backgroundFetching`.
10. `Sidebar.tsx` — 5-field shallow picker, similar split.
11. `MainPanel.tsx`, `TabBar.tsx` — whatever's left.

**Acceptance per file**: the touched component still renders identically; typecheck green.

### Step D — Convert mutations (one domain per PR)
Domains, in order of increasing blast radius:
1. **Staging** — ChangesPanel, StagingArea, DiffViewer, WipFileDiff.
2. **Stashes** — StashList, StashDetail, StashContextMenu + toolbar stash buttons.
3. **Tags** — TagCreateDialog, TagList.
4. **Remotes** — RemotesPanel, AddRemoteDialog, EditRemoteDialog.
5. **Worktrees** — WorktreeList, WorktreeAddDialog.
6. **Branches** — BranchCreateDialog + upstream tweaks.
7. **History ops** — checkout, cherry-pick, revert, reset, undo/redo (CommitContextMenu, BranchContextMenu, BranchGraph, Toolbar).
8. **Remote-sync** — pull/push/fetch (Toolbar, BranchList, BranchContextMenu, CommandPalette).
9. **Commit + merge/rebase** — CommitPanel, MergeRebaseDialog, ConflictList, MergeEditor, MainPanel.
10. **PRs** — PRCreateDialog, PRDetail.

For each domain:
1. Introduce `useXMutation()` hooks per mutation.
2. Replace every call site's `await gitApi.foo(...); await refreshAll()` with `await mutateAsync(...)` (invalidation is built in).
3. Remove the now-dead `refreshAll`/`refreshStatus`/`refreshStashes` calls at those sites.
4. **Add a browser test per domain** under `src/components/<area>/*.browser.test.tsx` using the existing `renderWithRepo` harness (extended in Step F, but the base mock + event bridge already work). Assertion shape: click a UI control → assert the matching `gitApi.*` mock fired with the right args → assert the correct `["repo", path, KIND]` query refetched (check via `queryClient.getQueryState(key).dataUpdateCount > prev`, or simpler: stub the query's IPC, fire it, assert the rendered DOM updated).
5. **Acceptance per domain**: `pnpm test:run` stays green (new tests included), manual click-through covers every action in the domain.

### Step E — Delete the bridge and the old fan-out
Once every mutation goes through TQ and every read uses a hook:
1. Delete the old `window.gitApi.onRepoChanged` listener in `App.tsx`. Only `RepoEventBridge` remains.
2. Delete every `refreshX` method from `repo.ts`.
3. Delete `patchTab`, `refreshAll`, `loadMoreCommits` from `repo.ts`.
4. Delete the `loading`, `commitsExhausted`, `loadingMoreCommits`, and all server-state fields from `TabData`.
5. Simplify `useActive` / `useActiveTabShallow` to the trimmed shape.
6. **Acceptance**: full app click-through (every view, every dialog, every toolbar action). Diff the before/after DOM / timing under React Profiler — should be at worst equivalent, typically better (narrower invalidations).

### Step F — Final trim + rename
1. Rename `useRepo` → `useTabs` (or keep, but collapse the interface to §4).
2. Consider hoisting `ghAvailable` into `useGhAvailable`.
3. Update tests: the browser smoke tests in `src/components/graph/ChangesPanel.browser.test.tsx`, `BranchGraph.browser.test.tsx`, `repo.browser.test.tsx` that currently poke `useRepo.setState` need to use `queryClient.setQueryData` on seeded tabs. Rewrite `renderWithRepo` → `renderWithRepoAndQueries(ui, { tab, seed })`.
4. Delete `setup.ts`'s `useRepo` reset dance; reset `QueryClient` instead (`queryClient.clear()` in afterEach).
5. **Acceptance**: every test stays green; manual click-through on all views.

---

## 6. Risks / open questions

- **React 19 StrictMode double-render + useInfiniteQuery.** `opensInFlight` currently dedupes `openRepo`. With TQ, the same key dedupe is built in — double-fire should be harmless. Verify on repo open.
- **Focus-poll vs `refetchOnWindowFocus`.** Default TQ refetches on focus for every active query in `["repo", path, *]`. That's stronger than today (we only poll status). Might cause extra `branches`/`log` fetches on window focus. Mitigation: `refetchOnWindowFocus: false` per-hook except `useGitStatus` (and maybe `useGitStashes`).
- **5s polling.** Current `setInterval(poll, 5000)` invalidates status whether the window is idle or active. Replace with `refetchInterval: 5000` + `refetchIntervalInBackground: false` on `useGitStatus` so it only runs when visible.
- **`useInfiniteQuery` + `LOG_PAGE_SIZE`.** `getNextPageParam` must return `totalCommitsSoFar` (a `skip` value), not a page index. Dedupe by hash is no longer needed if pages never overlap — confirm behaviour under the current race (refreshLog + loadMoreCommits firing concurrently) or keep the dedupe inside `select`.
- **`ghAvailable`** is loaded at tab-open today via `maybe(ghApi.available())`. Moving it into a query changes ordering: the first render sees `undefined` until the query resolves. Components relying on `ghAvailable ?? false` handle that correctly; verify.
- **`gcTime` causing tab-switch flashes.** If `gcTime` is too short, switching back to a tab after >5 minutes re-fetches from scratch and flashes empty state. Recommend default `gcTime: 30m` so tab-switch is instant up to that window.
- **PR state filter key.** `usePRs` keys on `prStateFilter` from `useSettings`. Changing the setting must invalidate; because the key changes, TQ fetches the new data automatically (no explicit invalidate needed). Verify.
- **Imperative test access.** The three browser tests call `useRepo.getState().tabs[0]` — those assertions move to `queryClient.getQueryData(["repo", path, "X"])` in Step F.
- **Watcher `worktree` vs `index` dedup.** Today they invalidate the same set. If a future refactor splits them (e.g. worktree should NOT invalidate stashes), the mapping in `RepoEventBridge` is the single place to change.

---

## 7. Deferred follow-up — `03b-detail-view-queries.md`

Three read-only detail fetches currently live as local `useEffect + useState` pairs. They're independent from the main `refreshAll` → `invalidateQueries` migration, so they land as a separate PR after Step F:

| Hook | queryKey | queryFn | staleTime | Callers |
| --- | --- | --- | --- | --- |
| `useCommitFiles(path, hash)` | `["repo", path, "commit-files", hash]` | `unwrap(gitApi.commitFiles(hash))` | `Infinity` | `CommitDetail.tsx` |
| `useWipDiff(path, args)` | `["repo", path, "diff", "wip", args]` | `unwrap(gitApi.diff(args))` | `0` | `WipFileDiff.tsx`, `DiffViewer.tsx` — WIP: invalidated by `status` watcher events. |
| `useCommitDiff(path, args)` | `["repo", path, "diff", "commit", args]` | `unwrap(gitApi.diff(args))` | `Infinity` | `CommitFileDiff.tsx` — immutable per commit range. |
| `useStashShowFiles(path, index)` | `["repo", path, "stash-files", index]` | `unwrap(gitApi.stashShowFiles(index))` | `Infinity` | `StashDetail.tsx` |

Acceptance: each call site drops its local `useState` + `useEffect` pair; typecheck green; click through Commit detail, stash detail, a WIP diff while staging, and a committed-file diff to confirm no regression.

Open the WIP hook first so the invalidation path (status watcher → WIP diff refetches) is proven before touching the immutable ones.

## 8. Out of scope (explicitly)

- Migrating `useUI` / `useSettings` to TQ. They're client state.
- Caching diffs forever across tab close. `gcTime: 10m` is enough; callers refetch when needed.
- Optimistic updates. Git mutations are fast (<200ms typical) and the watcher invalidates anyway — skip `onMutate` / rollback complexity in Step D.
- Main-process tests (see Task 13 if ever written).
