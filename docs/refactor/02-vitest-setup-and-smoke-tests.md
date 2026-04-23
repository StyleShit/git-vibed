# Task 02 — Add Vitest and write smoke tests

> **Prerequisite:** read `00-shared-context.md` first — it contains mandatory project conventions and guardrails that apply to this task.

## Why
Zero tests today. The next task (TanStack Query migration) will refactor the state pipeline — without at least a smoke-test safety net, regressions will ship silently.

## Goal
1. Set up Vitest + jsdom.
2. Unit-test pure logic modules.
3. Add a small number of integration smoke tests that exercise the state pipeline end-to-end (git action → store update → component shows it).

## Dependencies to add (dev)
```
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

## Config
- Add `vitest.config.ts` with `environment: 'jsdom'`, React plugin, path aliases matching `vite.config.ts` and `tsconfig.json`.
- Add `src/test/setup.ts` that imports `@testing-library/jest-dom/vitest` and provides a minimal mock of `window.gitApi` (every method returns `{ ok: true, value: <sensible default> }`).
- Add scripts to `package.json`:
  - `"test": "vitest"`
  - `"test:run": "vitest run"`
  - `"test:ui": "vitest --ui"`

## Unit tests to write (pure functions — no React, no IPC)
Find and test each of these. If a module doesn't exist under the exact name, use Grep to locate the equivalent:
1. **Merge engine** — `src/**/merge-engine.ts` or similar. Test: conflict region detection, decision application (ours / theirs / both), rename handling if present.
2. **Diff / status parser** — `src/**/parser.ts` or `src-electron/**/parser.ts`. Test: parse `git status --porcelain` output, parse numstat, parse a simple unified diff.
3. **Branch / commit tree layout** — the graph layout used by `BranchGraph.tsx`. Test: simple linear history, two-branch merge, octopus merge if supported.
4. **Path / tree building** — `buildTree(files)` used by `ChangesPanel.tsx`. Test: flat list → nested tree, edge cases (empty, single file, deeply nested).

Target: ≥ 1 happy-path test and ≥ 2 edge-case tests per module.

## Integration smoke tests (React Testing Library)
Mock `window.gitApi` and assert the store + UI reacts correctly.

1. **stage → status updates:** calling `gitApi.stage(['foo.ts'])` then firing an `EVENTS.REPO_CHANGED` (`index`) event updates `useRepo` status, and `<ChangesPanel>` moves `foo.ts` from unstaged to staged.
2. **commit → log updates:** mock `gitApi.commit` then fire a `head + refs` change event; `useRepo.log` contains the new commit.
3. **checkout → branches update:** mock `gitApi.checkout` then fire a `refs` event; `useRepo.branches[].current` points to the new branch.

Use a helper `renderWithRepo(ui, { initialTab })` that seeds `useRepo` and resets it between tests (`useRepo.setState(...)` in `beforeEach`).

## Plan
1. Install deps, add `vitest.config.ts`, `src/test/setup.ts`, and scripts.
2. Write a single "hello world" test to confirm the harness works.
3. Add unit tests in order of increasing complexity (parser → tree → merge-engine → graph layout).
4. Add the three integration smoke tests.
5. Run `pnpm test:run` and ensure all pass. Commit.

## Acceptance criteria
- `pnpm test:run` exits 0.
- At least 4 unit test files + 3 integration test files.
- No real IPC invoked during tests — `window.gitApi` fully mocked via setup.
- Running tests does not leak console errors or unhandled rejections.
- Tests do not depend on test execution order.

## Guardrails
- Do not modify production code to make tests pass unless the change is obviously correct and tiny (report anything larger).
- Do not add snapshot tests for components — too brittle for this codebase.
- Do not try to test the Electron main process in this task.
