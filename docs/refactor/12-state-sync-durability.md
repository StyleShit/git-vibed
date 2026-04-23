# Task 12 — State-sync durability fixes

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Context
Three narrow robustness issues in `src/stores/repo.ts` and `src/App.tsx`:

1. **`openRepo()` deduplication is racy.** Current implementation uses a `Set<string>` (`opensInFlight` near the top of `repo.ts`) but the membership check happens *after* the IPC round trip in some paths, so two concurrent opens for the same path can both proceed.
2. **Session persistence relies on microtask debounce only.** On a crash or hard-quit between the debounce and disk write, tab list is lost. No `beforeunload` flush.
3. **Worktree-poll tradeoff is undocumented.** The 5s interval in `App.tsx` (around line 177) is a magic number; the reason it exists (watcher skips `.git/` worktree due to EMFILE) isn't recorded anywhere the next reader will find.

## Goal
Fix all three; no behaviour changes for the happy path.

## Changes

### 1. openRepo dedup via Promise map
In `src/stores/repo.ts`:
- Replace `const opensInFlight = new Set<string>()` with `const opensInFlight = new Map<string, Promise<Result<TabData>>>()` (adapt generic types to whatever `openRepo` actually returns).
- At the top of `openRepo(path)`: if `opensInFlight.has(path)`, return `opensInFlight.get(path)!`.
- Otherwise construct the work promise, `set(path, promise)`, attach a `.finally(() => opensInFlight.delete(path))`, return the promise.
- Callers already await — no change needed.

### 2. beforeunload session flush
In `src/stores/repo.ts` (or wherever `queueSessionWrite` lives):
- Expose a synchronous `flushSession()` that writes immediately, bypassing the microtask queue. Keep the async batching logic for normal writes.
- In `src/App.tsx` (top-level effect, after stores are initialized): add `useEffect(() => { const onUnload = () => flushSession(); window.addEventListener('beforeunload', onUnload); return () => window.removeEventListener('beforeunload', onUnload); }, [])`.

### 3. Worktree-poll constant + comment
In `src/App.tsx`:
- Extract the `5000` interval to a named constant `const WORKTREE_POLL_INTERVAL_MS = 5000;` near the top of the file.
- Add a 2-3 line comment above the polling `useEffect` explaining: "Main-process watcher observes `.git/` only — watching the worktree causes EMFILE on large repos. Unstaged file changes are caught by this poll plus focus/visibility listeners."

## Plan
1. Change 1 — `openRepo` dedup. Manual test: double-click a repo in the welcome screen fast; confirm only one tab opens.
2. Change 2 — session flush. Manual test: open multiple repos, close the window via Cmd-Q, reopen — tabs are restored. Repeat with DevTools open and `process.crash()` if available.
3. Change 3 — constant + comment. No runtime change.

## Acceptance criteria
- Concurrent `openRepo(path)` calls share a single IPC round trip.
- `pnpm typecheck` passes.
- Session persists across normal app quit even when the last tab change happened < 1ms before quit.
- The polling constant has a clear name and comment.

## Guardrails
- Do NOT change the IPC contract of `openRepo` or its return type.
- Do NOT introduce new dependencies.
- Do NOT change the `5000` value — just extract it.
- Keep the three changes in separate commits.
