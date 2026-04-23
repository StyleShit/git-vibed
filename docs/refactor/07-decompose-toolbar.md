# Task 07 — Decompose Toolbar.tsx

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Context
`src/components/layout/Toolbar.tsx` is **~642 lines** and holds 5 `useState` slots for menu open/close state. It embeds: repo selector, branch selector, sync controls (pull / push / fetch), undo/redo, pull-strategy dropdown.

## Dependency on Task 01
Ideally, Base UI's `Menu` already replaces the `useState` open/close slots. If Task 01 is complete, you'll only need to split the sections; if not, do both here.

## Suggested seams
1. **`<RepoSelector>`** — current repo + tab switcher.
2. **`<BranchSelector>`** — current branch dropdown.
3. **`<SyncControls>`** — pull / push / fetch group + pull-strategy submenu.
4. **`<UndoRedoControls>`** — undo / redo buttons + tooltips.
5. **`Toolbar.tsx`** — layout + composition only. Target ≤ 150 lines.

## Plan
1. Extract each section into its own file under `src/components/layout/toolbar/`.
2. Keep all IPC calls and mutation logic inside the leaf sections that own them.
3. If Task 01 is done, use `Menu` from Base UI; otherwise keep the current `useState` model but isolate it per section.
4. Delete any residual top-level `useState` for menu-open slots.

## Acceptance criteria
- `Toolbar.tsx` ≤ 200 lines, purely composes children.
- Each new section file < 250 lines.
- No remaining `useState<boolean>` for menu open/close at the Toolbar level.
- Pull (with both strategies), push, fetch, repo switch, branch switch, undo, redo — all still work.
- `pnpm typecheck` passes.

## Guardrails
- Preserve keyboard shortcuts and tooltip text.
- Preserve exact button order and Tailwind classes.
- Keep the public prop API of `<Toolbar>` identical.
