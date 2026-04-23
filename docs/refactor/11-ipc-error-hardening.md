# Task 11 — Harden IPC error handling

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Context
Several IPC calls are fire-and-forget with `void window.gitApi.X(...)`. If the call rejects, the error vanishes silently (unhandled promise rejection at best). Known offenders — verify with Grep:
- `src/App.tsx` around lines 50, 67 — `void window.gitApi.setAutoFetchInterval(...)`, `void window.gitApi.onRepoChanged(...)`.
- There are likely a dozen more — grep for `void window.gitApi` across `src/`.

Additionally, some awaited calls use `maybe()` (swallow on error) where they should `unwrap()` + toast — e.g. post-write `refreshStatus()` calls that leave the UI inconsistent if they fail.

## Goal
- Every IPC call handles its error: either `.catch(console.error)` for background calls, or surfaces via `toast('error', ...)` for user-initiated ones.
- Every `maybe()` site is justified (truly-optional call, host without `gh`, etc.) or converted to `unwrap()` + error toast.

## Plan
1. `grep -rn "void window.gitApi" src/` — list every site.
2. For each, classify:
   - **Background / lifecycle** (auto-fetch interval, subscription setup): add `.catch((e) => console.error('<what failed>:', e))`.
   - **User-initiated** (button click, keyboard shortcut): await, wrap in try/catch, `toast('error', ...)` on failure.
3. `grep -rn "maybe(" src/` — list every site. For each, decide:
   - Keep `maybe()` only if failure is genuinely non-fatal and invisible to the user (e.g. optional `gh` lookups).
   - Otherwise convert to `unwrap()` + toast.
4. Confirm `App.tsx` watcher subscription logs errors and doesn't break the listener chain.

## Acceptance criteria
- `grep -r "void window.gitApi" src/` returns either zero matches, or each match has a `.catch` on the same or next line.
- No unhandled promise rejections in the DevTools console during normal app use (open repo, switch tabs, stage, commit, pull).
- Failed user-initiated actions surface a toast, not silence.
- `pnpm typecheck` passes.

## Guardrails
- Do NOT swallow errors with empty `.catch(() => {})`.
- Do NOT change the `Result<T>` contract in `src/lib/ipc.ts`.
- Do NOT add a new global error reporter / Sentry / etc.
- Keep commits small — one logical grouping per commit.
