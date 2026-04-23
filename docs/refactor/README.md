# Refactor Tasks — Agent Entry Point

> **If an agent was pointed at this README and asked to implement a task, follow the procedure below exactly.**

## Procedure for agents

1. **Read `00-shared-context.md` in full.** It contains project conventions, file layout, IPC patterns, styling rules, and guardrails that apply to every task. Do not skip it — tasks assume it.
2. **Match the user's request to a task file** using the Status table below. The user will name a task (e.g. "base ui migration", "decompose merge editor", "error boundaries"). Match on substring; ask the user to clarify if two tasks could both match.
3. **Check the Status column for the matched task.**
  - If **Not started** or **Blocked** → proceed to step 4.
  - If **In progress** → report the current state to the user and ask whether to continue, restart, or stop.
  - If **Done** → **STOP.** Reply to the user with: "Task `NN - <name>` is already marked Done in the README (completed: `<date>`, commit: `<sha>`). Are you sure you want to re-execute it? Re-running may undo completed work or produce a no-op diff." **Wait for explicit confirmation before doing anything else.** Do not read the task file, do not run typecheck, do not explore the codebase until the user says yes.
4. **Mark the task `In progress` in the Status table** (edit this README — can be a standalone commit before you start, or bundled into your first commit).
5. **Read the matched task file in full** before writing any code.
6. **Read every file the task file points to** (paths and line numbers may have drifted — verify with Grep before editing).
7. **Follow the task's "Plan" section in order.** If the task file asks you to confirm seams or produce a plan before coding (tasks 03, 04, 05, 06), do that and wait for the user's OK before continuing.
8. **Respect every "Guardrails" and "Acceptance criteria" section.** Those are not optional.
9. **Before finishing,** run `pnpm typecheck` and `pnpm dev` (the latter for a manual click-through of the touched feature).
10. **On success, mark the task `Done` in the Status table** with today's date and the final commit SHA (short form). Commit the README change together with — or immediately after — the task's final commit.
11. **If you stop partway** (blocker, interrupt, acceptance criteria unmet), update the Status to `Blocked` with a one-line reason so the next agent or human knows where things stand.

## Status legend

- **Not started** — never touched.
- **In progress** — an agent is actively working on it, or paused mid-way.
- **Blocked** — started but stopped; reason noted.
- **Done** — all acceptance criteria met, merged to `main`.

## Task index & status


| #   | Status      | Done on    | Commit  | File                                                                     | User phrasing likely to match                                              |
| --- | ----------- | ---------- | ------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 00  | —           | —          | —       | [00-shared-context.md](00-shared-context.md)                             | (reference — always read first)                                            |
| 01  | Done        | 2026-04-23 | 698f6d0 | [01-base-ui-migration.md](01-base-ui-migration.md)                       | "base ui", "base-ui", "dialog migration", "context menu library"           |
| 02  | Not started | —          | —       | [02-vitest-setup-and-smoke-tests.md](02-vitest-setup-and-smoke-tests.md) | "vitest", "tests", "smoke tests", "test setup"                             |
| 03  | Not started | —          | —       | [03-tanstack-query-plan.md](03-tanstack-query-plan.md)                   | "tanstack query plan", "react query plan", "query migration plan"          |
| 04  | Not started | —          | —       | [04-decompose-merge-editor.md](04-decompose-merge-editor.md)             | "decompose merge editor", "split merge editor", "merge editor refactor"    |
| 05  | Not started | —          | —       | [05-decompose-branch-graph.md](05-decompose-branch-graph.md)             | "decompose branch graph", "split branch graph", "graph refactor"           |
| 06  | Not started | —          | —       | [06-decompose-changes-panel.md](06-decompose-changes-panel.md)           | "decompose changes panel", "split changes panel", "staging panel refactor" |
| 07  | Not started | —          | —       | [07-decompose-toolbar.md](07-decompose-toolbar.md)                       | "decompose toolbar", "split toolbar", "toolbar refactor"                   |
| 08  | Not started | —          | —       | [08-fix-hook-discipline.md](08-fix-hook-discipline.md)                   | "hook discipline", "eslint-disable", "exhaustive-deps"                     |
| 09  | Not started | —          | —       | [09-strip-over-memoization.md](09-strip-over-memoization.md)             | "memoization", "usememo cleanup", "strip memos"                            |
| 10  | Not started | —          | —       | [10-error-boundaries.md](10-error-boundaries.md)                         | "error boundaries", "crash handling"                                       |
| 11  | Not started | —          | —       | [11-ipc-error-hardening.md](11-ipc-error-hardening.md)                   | "ipc errors", "error hardening", "unhandled promise"                       |
| 12  | Not started | —          | —       | [12-state-sync-durability.md](12-state-sync-durability.md)               | "state sync", "openrepo race", "session persistence", "worktree poll"      |


## Recommended execution order (for the human)


| #   | Task                    | Why this order                                                    | Risk   |
| --- | ----------------------- | ----------------------------------------------------------------- | ------ |
| 01  | Base UI migration       | Low-risk, immediate UX/a11y win, proves the agent-delegation loop | Low    |
| 02  | Vitest + smoke tests    | Safety net for everything that follows                            | Low    |
| 03  | TanStack Query **plan** | Produces the execution plan; no code changes                      | Low    |
| 04  | Decompose MergeEditor   | Can also run earlier; easier once reads are declarative           | Medium |
| 05  | Decompose BranchGraph   | Same                                                              | Medium |
| 06  | Decompose ChangesPanel  | Same                                                              | Medium |
| 07  | Decompose Toolbar       | Depends on 01 (Base UI menus)                                     | Low    |
| 08  | Fix hook discipline     | Mop-up; delegate one file at a time                               | Low    |
| 09  | Strip over-memoization  | Mop-up                                                            | Low    |
| 10  | Error boundaries        | One-shot                                                          | Low    |
| 11  | IPC error hardening     | One-shot                                                          | Low    |
| 12  | State-sync durability   | One-shot                                                          | Low    |


## Notes on delegation

- Tasks **03, 04, 05, 06** require the agent to propose a plan / seams and **wait for human confirmation** before coding.
- Task 03 outputs a new file (`04-tanstack-query-execution.md` or `04a/b/c/d-*.md`) which itself becomes delegable. When Task 03 completes, add its output rows to the Status table with "Not started".
- Task 08 should be delegated **one file at a time**, not in bulk — each `eslint-disable` has its own local reason. Mark it **Done** only when every site is fixed.
- Tasks 10–12 are safe one-shot delegations.

## Deliberately deferred (do not start without re-evaluating)

- Shared component library / workspace package.
- `react-hook-form` / `zod`.
- Custom `gh` HTTP client.
- Per-resource `useSyncExternalStore` hooks (TanStack Query is the right version — Task 03).

