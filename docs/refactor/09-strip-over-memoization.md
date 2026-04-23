# Task 09 — Strip unnecessary `useMemo` / `useCallback`

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Context
The codebase memoizes aggressively. Most memos wrap sub-millisecond computations whose dependency arrays change as often as the computation would re-run without memoization — net zero, with added cognitive overhead. React's compiler will eventually handle the legitimate cases; for now, keep only the proven-expensive ones.

Known over-memoization sites (verify):
- `src/components/graph/ChangesPanel.tsx` around lines 71 and 697 — `{staged, unstaged}` filter and `buildTree(files)`.
- `src/components/layout/Sidebar.tsx` around lines 52 and 64 — a `Set` and the `sections` array.
- Numerous `useCallback` wrapping onClick handlers that are passed to unmemoized children.

Legitimate expensive memos to KEEP:
- `src/components/graph/BranchGraph.tsx` graph layout (`useMemo` around line 90) — genuinely expensive, real benefit.
- Branch highlight graph traversal (same file, around lines 98-99).

## Goal
Delete `useMemo` / `useCallback` where the computation is obviously sub-millisecond AND the result is not fed into another hook's dependency array.

## Heuristic
- **Delete** if: compute is a simple filter, map, object spread, Set construction, or static array; result is consumed inline in JSX.
- **Keep** if: compute involves graph traversal, ≥ 500 iterations, expensive parsing, OR the result is a dep of another hook where reference stability matters.
- **Ambiguous:** measure with React DevTools profiler; default to deleting. Add a one-line comment `// memoized: <N>ms` if you keep a non-obvious one.

## Plan
1. Grep all `useMemo(` / `useCallback(` call sites under `src/components/`.
2. For each: classify (delete vs keep) using the heuristic. Document deletions in the commit message grouped by file.
3. For each delete: verify no downstream hook depends on the reference being stable (i.e., nothing else has the memo's result in its deps array). If it does, decide whether that downstream hook actually needs the stability.
4. Run `pnpm typecheck` and click through the touched screens.

## Acceptance criteria
- Net reduction of memo/callback sites (aim for ≥ 30% fewer).
- Every remaining memo is either expensive (documented why if non-obvious) or feeds another hook's deps.
- No performance regressions observable in manual use (graph scroll, panel switching, staging selection).

## Guardrails
- Do NOT delete memos in `BranchGraph.tsx` that wrap graph layout or highlighting without profiling first.
- Do NOT delete `useCallback` on handlers passed into `<React.memo>`-wrapped children.
- Do NOT replace `useMemo` with IIFE patterns — just inline the expression.
- One commit per logical group of files.
