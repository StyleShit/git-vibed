# Task 04 — Decompose MergeEditor.tsx (PLANNING + EXECUTION)

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Context
`src/components/merge/MergeEditor.tsx` is **~1338 lines** in a single component. It combines:
- Monaco integration for three panes (ours / theirs / result).
- Conflict region parsing.
- Per-line decision tracking (ours / theirs / both / custom).
- Decoration updates on Monaco.
- Rename detection and path resolution.
- File list (conflicts remaining).
- Keyboard shortcuts.
- Save / abort handlers.

One prop change re-renders everything. Testing and reasoning about it is painful.

## Goal
Split into smaller, single-responsibility pieces with a clear state-management boundary. **No behaviour changes.**

## Suggested seams (but use your judgment — the module's current structure has the final say)
1. **`useMergeState(regions)`** — custom hook owning the per-line decision map, undo/redo of decisions, and the derived "result text" string. Pure logic, no Monaco.
2. **`<ConflictList>`** — the list of files still in conflict + navigation between them.
3. **`<ConflictPane>`** — one Monaco editor with its decoration controller. Takes `{ kind: 'ours' | 'theirs' | 'result', content, decisions, onDecisionChange }`. Lives three times in the screen.
4. **`<DecisionGutter>`** — the per-hunk buttons (Take ours / Take theirs / Both / Edit manually).
5. **`MergeEditor.tsx`** — the orchestrator. Holds layout, wires the hook and the three panes together, nothing else. Target ≤ 200 lines.

## Plan
1. **Spike (do not commit):** read `MergeEditor.tsx` top-to-bottom; sketch the current state graph (what triggers what) in a comment at the top of this file. Confirm the seams above or propose different ones in a short reply before coding.
2. Extract `useMergeState` first — pure, testable, safe to land alone. Move decision logic and derived result text. Delete the equivalent inline code from `MergeEditor`.
3. Extract `<DecisionGutter>` — it's the smallest leaf.
4. Extract `<ConflictPane>` — biggest single win; isolates Monaco per-pane.
5. Extract `<ConflictList>` — often the simplest, just a sidebar.
6. Clean up `MergeEditor.tsx` — remove dead state, dead memos, dead effects left behind.
7. Add unit tests for `useMergeState` (reuses vitest harness from task 02).

## Acceptance criteria
- `MergeEditor.tsx` ≤ 300 lines (ideally ≤ 200).
- Each new subcomponent < 300 lines.
- No new `useEffect` with `// eslint-disable` directives introduced.
- Zero behaviour regressions: open a real conflicted merge (`git merge <branch>` that conflicts), resolve via each pane decision path, save, abort, navigate between conflicted files. All still works.
- `useMergeState` has ≥ 3 unit tests covering: apply-ours, apply-theirs, apply-both, undo of a decision.
- `pnpm typecheck` passes.

## Guardrails
- Do NOT change the persisted output format, the keyboard shortcuts, or the save/abort IPC calls.
- Do NOT refactor the Monaco theme, diff styling, or decoration colors.
- Do NOT pull in new dependencies.
- If you find a bug while decomposing, file it as a separate task — do not fix in-line.
- Keep the public prop API of `<MergeEditor>` identical.
