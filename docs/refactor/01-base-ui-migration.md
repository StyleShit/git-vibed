# Task 01 — Replace hand-rolled UI primitives with Base UI

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Why
Hand-rolled Dialog, Confirm, Prompt, ContextMenu, and Toolbar dropdowns each reinvent outside-click handling, Esc handling, focus trapping, viewport clamping (`useMenuPosition`), and keyboard nav — poorly and without ARIA. Base UI (successor to Radix, backed by the MUI + Floating UI teams, stable v1.0 Dec 2025) solves all of this with a compositional API close to Radix.

## Goal
Replace the primitives below with Base UI implementations. Keep the **public prop API of each wrapper identical** so callers don't change.

## Dependency to add
```
pnpm add @base-ui-components/react
```
Nothing else. Do not add `@floating-ui/react` (Base UI bundles it).

## Files to rewrite (wrappers — preserve props)
1. `src/components/ui/Dialog.tsx` → on `@base-ui-components/react/Dialog`.
2. `src/components/ui/Confirm.tsx` → on `AlertDialog`.
3. `src/components/ui/Prompt.tsx` → on `Dialog` with a controlled input.
4. `src/components/graph/CommitContextMenu.tsx` → on `ContextMenu`.
5. `src/components/graph/StashContextMenu.tsx` → on `ContextMenu`.
6. `src/components/branches/BranchContextMenu.tsx` → on `ContextMenu`.
7. `src/components/layout/Toolbar.tsx` dropdowns (the 5 `useState` menu-open slots) → on `Menu`.

## Files to delete after migration
- `src/hooks/useMenuPosition.ts` — replaced by Base UI's positioning middleware.
- Every inline outside-click `useEffect` in the above components.
- Every inline `Escape` keyboard handler in the above components.

## Styling
- Keep current Tailwind classes (neutral-800 border, neutral-900 bg, shadow-xl, rounded-md, py-1, min-w-[180px]).
- Use Base UI's unstyled slots — apply your existing classes via `className` on the equivalent parts (Popup, Trigger, Item, etc.).
- Preserve animation classes where present (e.g. `gui-modal-in`, `gui-backdrop-in` on Dialog).

## Prop API to preserve — examples
- `Dialog`: `{ title, children, onClose, width? }` — unchanged.
- `Confirm` (via `useConfirm()` hook): `{ title, message, confirmLabel, danger? } -> Promise<boolean>` — unchanged.
- `Prompt` (via `usePrompt()` hook): returns the entered string or null — unchanged.
- Context menus: `{ x, y, commit|stash|branch, onClose }`. With Base UI, the `x, y` model changes — the menu is triggered by a right-click event, not absolute coords. Adapt callers to use Base UI's `ContextMenu.Trigger` around the clickable row, OR, if that's too invasive for this PR, keep the `{x, y}` facade and portal the Base UI `ContextMenu.Popup` to those coordinates via a virtual anchor. Pick one and be consistent.

## Plan (suggested order)
1. Install dep; verify `pnpm typecheck` still passes.
2. Rewrite `Dialog.tsx`. Click through: commit dialog, any delete confirm, tag create. Verify Esc closes, click-outside closes, focus trap works.
3. Rewrite `Confirm.tsx` and `Prompt.tsx`. Test via the hooks.
4. Rewrite the three context menus. Test right-click on commits, stashes, branches.
5. Rewrite Toolbar dropdowns (repo selector, branch selector, pull menu, etc.).
6. Delete `useMenuPosition.ts`.
7. Grep for any remaining `useEffect` with `mousedown` outside-click or `keydown` Escape handlers in the touched files — delete them.

## Acceptance criteria
- No behavioural regressions: every dialog and menu opens, closes, respects Esc, click-outside, and keyboard navigation.
- `useMenuPosition.ts` deleted; no references remain (`grep -r useMenuPosition src`).
- No new `useEffect` with `mousedown` or `keydown` listeners for outside-click / Esc in the touched components.
- Focus returns to the trigger after menu/dialog close (Base UI gives this for free — verify).
- Tailwind visuals look identical (border, bg, shadow, spacing).
- `pnpm typecheck` and `pnpm dev` manual click-through pass.

## Out of scope
- Tooltips, Popovers beyond those listed above.
- Combobox / Select / any new primitives.
- Any design tweaks — strictly like-for-like replacement.
