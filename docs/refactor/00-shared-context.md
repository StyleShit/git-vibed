# Shared Context — Git Vibed Refactor

> Paste this at the top of every refactor-task prompt. It gives the agent the project brief, conventions, and guardrails that aren't obvious from reading a single file.

## Project
- Electron + React 19 + TypeScript git GUI.
- Package manager: **pnpm**. Bundler: **Vite**. Styling: **Tailwind v4**.
- Main-process runtime: Node. Renderer runtime: Chromium.
- No tests exist yet. No CI. Solo developer.

## Repo layout
- `src/` — renderer
  - `App.tsx` — root, mounts listeners for watcher events.
  - `components/` — grouped by feature: `commit/`, `graph/`, `branches/`, `merge/`, `layout/`, `ui/`, `stashes/`, `tags/`, `remotes/`, `worktrees/`, `github/`, `settings/`, `palette/`.
  - `stores/` — `repo.ts` (per-tab git state + tab identity), `ui.ts` (toasts, transient UI), `settings.ts` (persisted prefs).
  - `hooks/` — custom hooks.
  - `lib/ipc.ts` — `unwrap()`, `maybe()`, the `Result<T>` helpers.
  - `shared/` — `types.ts` (domain types), `ipc.ts` (channel constants: `GIT`, `GH`, `EVENTS`).
- `src-electron/` — main process
  - `main.ts`
  - `ipc/git-handlers.ts` — IPC handlers wrapping `simple-git`.
  - `watcher.ts` (or similar) — `RepoWatcher` watching `.git/` with 200ms debounce.

## Conventions to follow
- **IPC calls** always go through `window.gitApi.*` and return `Result<T>`. Callers use `unwrap()` to throw-on-error or `maybe()` to swallow. Errors surface via `toast()` from `useUI`.
- **State:** per-tab git data lives in `useRepo` (`stores/repo.ts`); mutations use `patchTab(path, patch)` which spreads into a new tab object (preserves zustand reference identity). Never mutate in place.
- **Selectors:** use `useActive('status')` for single-key reads or `useActiveTabShallow(picker)` with `useShallow` for multi-field reads. Do not do `useRepo(s => s)` — that re-renders on every mutation.
- **Watcher → renderer:** main-process watcher only observes `.git/` (worktree is too expensive, causes EMFILE). It emits typed `EVENTS.REPO_CHANGED` events: `head | index | refs | merge`. Worktree edits are caught by a 5s polling + focus/visibility listener in `App.tsx`.
- **Errors:** fire-and-forget IPC (`void gitApi.X(...)`) is currently common but WRONG — always attach `.catch(console.error)` or surface via `toast`.
- **Styling:** Tailwind only. Neutral palette (neutral-800 / neutral-900 / neutral-200). No inline colors, no CSS files.
- **Comments:** write none unless the WHY is non-obvious. No docstrings. No "used by X" comments.
- **No emojis.** Ever.
- **Commit style:** short imperative subject — see `git log` for examples like "Clamp context menus inside the viewport" and "Fully undo merge commits instead of leaving the delta staged".

## Guardrails
- **Do not** add dependencies beyond those listed in the specific task file.
- **Do not** introduce new global abstractions or design patterns not requested.
- **Do not** modify `simple-git` usage or git-handlers behaviour unless the task explicitly asks.
- **Do not** disable ESLint rules (`// eslint-disable-next-line ...`). If you feel tempted, redesign.
- **Do not** write CLAUDE.md, README, or other docs unless explicitly asked.
- **Keep the PR small.** One task per branch. If the task feels too big, stop and report back.
- **Preserve public component APIs.** If a component is used elsewhere with certain props, don't break callers without updating them in the same PR.

## Before starting any task
1. Read the task file completely.
2. Read the files it points to.
3. Run `git status` to confirm a clean tree.
4. Run `pnpm typecheck` to confirm baseline builds.
5. If anything in the task seems wrong or outdated, ask before proceeding — do not silently reinterpret.

## Definition of done (applies to every task)
- `pnpm typecheck` passes.
- `pnpm lint` passes (which currently just runs typecheck — same thing).
- The app starts with `pnpm dev` and the touched feature still works end-to-end (click through it manually).
- No new ESLint disables.
- No new unused exports, no dead code left behind.
