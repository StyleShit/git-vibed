# Task 06 — Decompose ChangesPanel.tsx (PLANNING + EXECUTION)

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Context
`src/components/graph/ChangesPanel.tsx` is **~863 lines**. It shows the staging area (staged / unstaged), supports tree / flat path view toggle, multi-select, right-click menus, and fires IPC calls on stage/unstage actions.

## Goal
Split by responsibility. **No behaviour changes.**

## Suggested seams
1. **`buildTree(files)`** — already a pure helper; confirm it's in its own module. If inline, move to `src/lib/file-tree.ts` and unit-test it.
2. **`<FileList>`** — flat or tree rendering, driven by a view prop. Owns selection state (lift up if shared).
3. **`<FileRow>`** — one row with status icon, path, selection checkbox.
4. **`useFileSelection(files)`** — multi-select logic (shift-click range, ctrl-click toggle, select-all).
5. **`<ChangesPanelActions>`** — the stage / unstage / discard toolbar at the top or bottom.
6. **`ChangesPanel.tsx`** — orchestrator. Target ≤ 200 lines.

## Plan
1. **Spike:** read the file; confirm the seams or revise in a short reply.
2. Extract `buildTree` + unit tests.
3. Extract `useFileSelection` + unit tests (shift-click range, ctrl-click, select-all).
4. Extract `<FileRow>` (leaf).
5. Extract `<FileList>` with tree/flat toggle.
6. Extract `<ChangesPanelActions>`.
7. Clean up `ChangesPanel.tsx`.

## Acceptance criteria
- `ChangesPanel.tsx` ≤ 250 lines.
- `buildTree` and `useFileSelection` have unit tests.
- Stage single, stage multiple, unstage, discard (with confirm), switch between tree and flat view, right-click menu — all still work.
- `pnpm typecheck` passes.

## Guardrails
- Preserve Tailwind visuals and row heights exactly.
- Do NOT change IPC signatures for stage/unstage/discard.
- Keep the public prop API of `<ChangesPanel>` identical.
