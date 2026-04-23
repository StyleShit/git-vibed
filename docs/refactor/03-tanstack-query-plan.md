# Task 03 — Migrate git state to TanStack Query (PLANNING PHASE)

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.
> **This is a Plan-only task.** Do NOT write application code. Produce a concrete implementation plan that subsequent tasks will execute.

## Why
Today `useRepo` is both a tab-identity store AND a hand-rolled cache of git data mirrored from the main process. Every mutation is followed by manual `refreshAll()` or `refreshStatus()` calls; the watcher listener in `App.tsx` owns a big fan-out table; per-tab cache lifecycle is manual. This is server-state, and TanStack Query is designed for server-state with external invalidation.

## Goal of this task
Produce `04-tanstack-query-execution.md` (or a series of files `04a`, `04b`, ...) describing exactly how to migrate, in small, independently-shippable steps. No production code changes.

## Inputs you must read before planning
- `src/stores/repo.ts` — full file; list every field on `TabData`, every `refreshX` method, every `patchTab` call site elsewhere in the codebase.
- `src/App.tsx` — the watcher `onRepoChanged` listener fan-out and the polling fallback.
- `src/lib/ipc.ts` — the `Result<T>` / `unwrap` / `maybe` helpers.
- `src/shared/ipc.ts` — event types (`EVENTS.REPO_CHANGED`, `head | index | refs | merge`).
- `src-electron/watcher.ts` (or the file where `RepoWatcher` lives) — confirm the exact event payload shape.
- Every `useActive(...)` / `useActiveTab(...)` call site in `src/components/**/*.tsx` — you will be replacing these.
- Every `.refreshAll()` / `.refreshStatus()` / `.refreshX()` call site in `src/components/**/*.tsx` — these become mutation invalidations.

## What the plan must contain
1. **Query hook inventory.** For each field on `TabData`, specify:
   - Hook name (`useGitStatus`, `useGitLog`, ...).
   - `queryKey` shape — include `repoPath` so tab-switching just works.
   - `queryFn` — the exact `window.gitApi.*` call it wraps.
   - `staleTime` / `gcTime` recommendations.
   - Whether it uses `useQuery` or `useInfiniteQuery` (log is the only infinite candidate).
2. **Mutation inventory.** Enumerate every write operation (stage, unstage, commit, amend, checkout, pull, push, fetch, cherry-pick, revert, reset, stash push/pop/drop/apply, branch create/delete, tag create/delete, remote add/edit/remove, worktree add/remove, PR create, merge, rebase, abort). For each:
   - Source component / hook.
   - `mutationFn` signature.
   - `onSuccess` invalidation targets (which `queryKey`s).
3. **Watcher wiring.** Show the exact one-function replacement for the `App.tsx` fan-out: `watcher event → queryClient.invalidateQueries` with the mapping `head → [branches, log, status, worktrees, undo]`, `index → [status, stashes]`, `refs → [branches, log, tags]`, `merge → [status]`. Verify this matches the current behaviour.
4. **Tab identity in zustand.** Spec the trimmed `useRepo`: what fields remain (tabs[]: {path, name, selectedCommit, selectedFile, activeIdx...}), what goes (all git data fields, all `refreshX` methods). Session persistence strategy unchanged.
5. **Migration order** (one PR per step):
   - Step A: Install TanStack Query, wrap root, add `useGitStatus` in parallel with existing `status` field. Prove one component reads the new hook while everything else stays the same.
   - Step B: Add all remaining read hooks, still in parallel with the old store.
   - Step C: Switch each consumer component from `useActive('x')` to `useGitX()`. Delete dead `useActive` sites.
   - Step D: Convert mutations one domain at a time (staging, commits, branches, stashes, tags, remotes, worktrees, PR).
   - Step E: Delete all `refreshX` / `patchTab` code paths for git data. Collapse `App.tsx` fan-out to `invalidateQueries`.
   - Step F: Trim `repo.ts` to tab identity only.
6. **Risks / open questions.** Log anything you're unsure about — e.g. how the polling fallback interacts with `refetchOnWindowFocus`, how `useInfiniteQuery` handles the existing `LOG_PAGE_SIZE = 500`, whether `gcTime` causes tab-switch flashes, whether any component reads data imperatively via `useRepo.getState()`.
7. **Acceptance criteria** for each step (what to manually click through).

## Output
Write the plan to `docs/refactor/04-tanstack-query-execution.md`. If it's too long, split into `04a-setup.md`, `04b-reads.md`, `04c-mutations.md`, `04d-cleanup.md` — linked from a short `04-overview.md`.

## Guardrails
- Do not modify any production code in this task.
- Do not skip reading the listed files. Vague plans will not be actioned.
- If the watcher event schema differs from what `00-shared-context.md` claims, trust what you read — note the discrepancy at the top of the plan.
- The final plan must let a fresh agent execute any one step without reading the others.
