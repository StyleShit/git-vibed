# Task 05 — Decompose BranchGraph.tsx (PLANNING + EXECUTION)

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Context
`src/components/graph/BranchGraph.tsx` is **~1123 lines**. It combines:
- Commit graph rendering (rows, lanes, connector paths).
- A detail sidebar for the selected commit.
- Right-click context menus (already partly extracted to `CommitContextMenu.tsx`).
- Sub-dialogs for create-branch-here, create-tag-here, etc.
- Graph layout computation (expensive — legitimately memoized).
- Branch highlighting on hover.

## Goal
Split into single-responsibility pieces with a clean data flow. **No behaviour changes.**

## Suggested seams (adjust based on the actual file)
1. **`graph-layout.ts`** (pure module) — the expensive layout walk (commits → lanes → connector shapes). Already a `useMemo`; extract into a pure function that returns `{ rows, lanes, edges }`. Testable.
2. **`<CommitRow>`** — one row of the graph (the circle, the connectors, the message, the refs). Pure, memoized.
3. **`<GraphCanvas>`** — the scrollable grid of rows. Owns selection, hover, keyboard navigation.
4. **`<CommitDetailSidebar>`** — the right-hand panel showing the selected commit's message, files, stats. Probably already exists as `CommitDetail.tsx` — confirm and consolidate.
5. **Inline dialogs** — extract any create-branch / create-tag dialogs if they live here. Use existing `Dialog` primitive.
6. **`BranchGraph.tsx`** — orchestrator. Target ≤ 250 lines.

## Plan
1. **Spike:** read `BranchGraph.tsx` + `CommitDetail.tsx` to map the current structure. Confirm or revise the seams in a short reply before coding.
2. Extract `graph-layout.ts`. Add unit tests (linear, branching, merge, octopus). Deletes the inline layout logic and replaces the `useMemo` with a call into the pure module.
3. Extract `<CommitRow>` — memoize with `React.memo` if props are stable.
4. Extract `<GraphCanvas>` — moves the row loop + keyboard handlers.
5. Consolidate commit detail into one component — delete dead duplication.
6. Clean up `BranchGraph.tsx` orchestrator.

## Acceptance criteria
- `BranchGraph.tsx` ≤ 300 lines.
- `graph-layout.ts` is pure, has no React imports, has ≥ 4 unit tests.
- Each new subcomponent < 300 lines.
- Click a commit, right-click a commit, hover a branch ref, open each context menu action — all still work.
- `pnpm typecheck` passes.

## Guardrails
- Preserve graph visuals exactly — no changes to lane colors, circle sizes, connector stroke, row height.
- Preserve keyboard shortcuts (arrow keys, Home/End if present).
- Do NOT change the commit context menu actions (that's `CommitContextMenu.tsx`).
- Keep the public prop API of `<BranchGraph>` identical.
