# Task 08 — Remove every `eslint-disable react-hooks` directive

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Context
Several components silence `react-hooks/exhaustive-deps` with an inline comment. Known sites (verify with Grep — there may be more):
- `src/App.tsx` around line 157 (open-saved-repos effect).
- `src/components/commit/CommitPanel.tsx` around lines 77 and 96.
- `src/components/graph/CommitDetail.tsx`.
- `src/components/stashes/StashDetail.tsx`.
- `src/components/settings/SettingsPanel.tsx`.

Each disable is a design smell. The linter is right; the fix is to restructure the hook.

## Goal
Zero `eslint-disable-next-line react-hooks/*` directives remain. Behaviour unchanged.

## Strategies (pick the right one per site)
1. **Stable handler via ref** — if the effect reads a value that changes often but the subscription must not re-fire, store the latest value in a `useRef` and read it inside the handler.
2. **`useCallback` for event handlers** — stabilize functions passed into effects.
3. **Extract a custom hook** — if the effect has 3+ dependencies and some are intentionally excluded, the shape is wrong; extract into a hook that takes them explicitly.
4. **Run-once effects** — if you truly need to run once on mount using current state, read from `useRepo.getState()` (non-reactive) inside the effect and declare `[]` deps honestly. That's still a smell but it's explicit — prefer one of the above.
5. **Derived state, not effect** — if the effect is only syncing state A → state B, the data is derived, not effectful. Delete the effect and compute B from A inline or via `useMemo`.

## Plan
1. `grep -rn "eslint-disable-next-line react-hooks" src/` — list every occurrence.
2. For each: read the effect, name which strategy above applies, apply it, verify behaviour by running the relevant UI flow.
3. Remove the directive.
4. Run `pnpm typecheck` and the app (`pnpm dev`).

## Acceptance criteria
- `grep -r "eslint-disable.*react-hooks" src/` returns no results.
- No new `useRef` that holds data you only read inside effects unless strategy 1 genuinely applies (no silent stale closures).
- All touched features still work: commit keyboard shortcuts, amend prefill, stash select, settings save, repo auto-open on launch.

## Guardrails
- Do NOT disable the rule at config level.
- Do NOT introduce new deps.
- Do NOT refactor unrelated code in the same file — keep the diff focused on the effect.
- If fixing one site requires touching more than ~30 lines, stop and report it as needing a bigger refactor.
