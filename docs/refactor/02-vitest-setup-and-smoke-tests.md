# Task 02 — Add Vitest (browser mode) and write smoke tests

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Why
Zero tests today. The next task (TanStack Query migration) will refactor the state pipeline — without at least a smoke-test safety net, regressions will ship silently.

**Why browser mode, not jsdom:** this app ships to a real Chromium (Electron). jsdom is a faked DOM that silently disagrees with real browsers on layout, events, clipboard, focus, IntersectionObserver, ResizeObserver, pointer events, and most of the APIs this app actually uses (context menus, Monaco editor, drag/drop, keyboard handling). Running component tests in a real Chromium via `@vitest/browser` + Playwright catches bugs jsdom hides and matches the runtime the app actually runs in.

## Goal
1. Set up Vitest with **browser mode** (Playwright provider, Chromium).
2. Unit-test pure logic modules (these run fast in the default Node environment).
3. Add a small number of integration smoke tests running in a real browser: git action → store update → component shows it.

## Dependencies to add (dev)
```
pnpm add -D vitest @vitest/browser @vitest/ui playwright @testing-library/react @testing-library/user-event @testing-library/jest-dom
```
Then:
```
pnpm exec playwright install chromium
```
(Do **not** add `jsdom` or `happy-dom`.)

## Config

### `vitest.config.ts`
Two projects in one config: a fast Node project for pure-logic unit tests, and a browser project for anything touching React / DOM. Path aliases must match `vite.config.ts` and `tsconfig.json`.

Shape (adapt to match existing vite config style):

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.unit.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
```

### `src/test/setup.ts`
- `import '@testing-library/jest-dom/vitest'`
- Provide a minimal mock of `window.gitApi` — every method returns `{ ok: true, value: <sensible default> }`. Expose helpers to override per-test.
- Provide a helper to dispatch watcher events (`EVENTS.REPO_CHANGED` with the typed payload `head | index | refs | merge`).
- Reset `useRepo` and `useUI` stores with `useRepo.setState(...)` in `beforeEach`.

### `package.json` scripts
- `"test": "vitest"`
- `"test:run": "vitest run"`
- `"test:ui": "vitest --ui"`
- `"test:unit": "vitest run --project=unit"` — fast, no browser
- `"test:browser": "vitest run --project=browser"`

## File-naming convention
- Pure logic: `*.unit.test.ts` — runs in Node, fast, no React/DOM allowed.
- React / DOM: `*.browser.test.tsx` — runs in Chromium.
This keeps the two worlds separate and cheap to grep for.

## Unit tests to write (pure functions — `*.unit.test.ts`)
Find and test each of these. Use Grep to locate the real module path:
1. **Merge engine** — `src/**/merge-engine.ts` or similar. Test: conflict region detection, decision application (ours / theirs / both), rename handling if present.
2. **Diff / status parser** — `src/**/parser.ts` or `src-electron/**/parser.ts`. Test: parse `git status --porcelain` output, parse numstat, parse a simple unified diff.
3. **Branch / commit tree layout** — the graph layout used by `BranchGraph.tsx`. Test: simple linear history, two-branch merge, octopus merge if supported.
4. **Path / tree building** — `buildTree(files)` used by `ChangesPanel.tsx`. Test: flat list → nested tree, edge cases (empty, single file, deeply nested).

Target: ≥ 1 happy-path test and ≥ 2 edge-case tests per module.

## Integration smoke tests (`*.browser.test.tsx`, React Testing Library in real Chromium)
Mock `window.gitApi` via `src/test/setup.ts` and assert store + UI react correctly.

1. **stage → status updates:** calling `gitApi.stage(['foo.ts'])` then dispatching `EVENTS.REPO_CHANGED` (`index`) updates `useRepo` status, and `<ChangesPanel>` moves `foo.ts` from unstaged to staged.
2. **commit → log updates:** mock `gitApi.commit` then fire a `head + refs` event; `useRepo.log` contains the new commit.
3. **checkout → branches update:** mock `gitApi.checkout` then fire a `refs` event; `useRepo.branches[].current` points to the new branch.

Use a helper `renderWithRepo(ui, { initialTab })` that seeds `useRepo` and resets it between tests.

Prefer `@testing-library/user-event` over `fireEvent` — it dispatches real browser events.

## Plan
1. Install deps, run `playwright install chromium`. Add `vitest.config.ts`, `src/test/setup.ts`, and scripts.
2. Write a single `hello.unit.test.ts` and a single `hello.browser.test.tsx` to confirm both harnesses work.
3. Add unit tests in order of increasing complexity (parser → tree → merge-engine → graph layout).
4. Add the three integration smoke tests.
5. Run `pnpm test:run` (both projects) and ensure all pass. Commit.

## Acceptance criteria
- `pnpm test:run` exits 0, running both the unit and browser projects.
- At least 4 unit test files (`*.unit.test.ts`) + 3 browser test files (`*.browser.test.tsx`).
- No real IPC invoked — `window.gitApi` fully mocked via setup.
- No `jsdom` or `happy-dom` anywhere in `package.json`, config, or imports.
- Browser tests run in headless Chromium by default; `pnpm test:browser --browser.headless=false` works for local debugging.
- No console errors or unhandled rejections during the run.
- Tests do not depend on execution order.

## Guardrails
- Do not modify production code to make tests pass unless the change is obviously correct and tiny (report anything larger).
- Do not add snapshot tests — too brittle.
- Do not test the Electron main process in this task.
- Do not import React / DOM APIs from `*.unit.test.ts` — keep the fast project clean.
- Do not add `jsdom` as a "fallback" — commit fully to browser mode.
