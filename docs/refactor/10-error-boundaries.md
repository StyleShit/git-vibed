# Task 10 — Add error boundaries

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Context
No error boundaries exist. A render throw anywhere crashes the whole app to a white screen — a bad UX for a desktop app, and hard to diagnose for the developer.

## Goal
1. One **root** `<ErrorBoundary>` that catches uncaught renderer errors and shows a minimal fallback UI with the error message and a "Reload" button.
2. Per-view boundaries around the two most complex components (`<BranchGraph>` and `<MergeEditor>`) so a bug in one doesn't take down the whole window.

## Files to add
- `src/components/ui/ErrorBoundary.tsx` — class component (still required for `componentDidCatch`). Accepts `{ fallback: ReactNode | ((error, reset) => ReactNode), onError?, children }`. Logs the error to `console.error` and optionally calls `onError`.

## Files to modify
- `src/main.tsx` (or wherever `<App>` is mounted) — wrap `<App>` in the root boundary.
- `src/components/layout/MainPanel.tsx` (or the actual parent of BranchGraph / MergeEditor) — wrap those two components in their own boundaries with a smaller fallback that suggests switching views.

## Fallback UX
- Root fallback: full-screen `bg-neutral-950 text-neutral-200`, centered card with title "Something went wrong", the error message in `<pre>`, a neutral-800 bordered button "Reload window" that calls `window.location.reload()`.
- Per-view fallback: inline card same palette, smaller, "This panel crashed — try switching tabs or reopening the repo", a "Try again" button that calls the reset function exposed by the boundary.

## Plan
1. Implement `ErrorBoundary` with `getDerivedStateFromError` + `componentDidCatch`.
2. Wrap `<App>` at the root.
3. Wrap `<BranchGraph>` and `<MergeEditor>` individually.
4. Manually verify: inject `throw new Error('test')` into each wrapped component, confirm the correct fallback appears, confirm "Reload" / "Try again" works, then remove the throw.

## Acceptance criteria
- Runtime errors in `<BranchGraph>` do not crash the Toolbar, Sidebar, or other tabs.
- Root boundary shows a readable fallback and reload works.
- `pnpm typecheck` passes.

## Guardrails
- Do NOT use any third-party error-boundary lib.
- Do NOT swallow errors silently — always `console.error` them.
- Do NOT catch async errors in the boundary (React limitation) — those belong to the IPC hardening task (see 11).
