import type { IpcMain } from "electron";
import { GH } from "../../src/shared/ipc.js";
import { GhExecutor } from "../github/executor.js";
import type { PRCreateOptions, PRReviewOptions, Result, MergeMethod } from "../../src/shared/types.js";

function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  return fn().then(
    (data) => ({ ok: true as const, data }),
    (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
  );
}

export function registerGhHandlers(ipc: IpcMain, getCwd: () => string | null) {
  const gh = new GhExecutor(getCwd);

  ipc.handle(GH.AVAILABLE, () => wrap(() => gh.available()));
  ipc.handle(GH.PR_LIST, (_e, state?: "open" | "closed" | "all") =>
    wrap(() => gh.prList(state ?? "open")),
  );
  ipc.handle(GH.PR_VIEW, (_e, num: number) => wrap(() => gh.prView(num)));
  ipc.handle(GH.PR_CREATE, (_e, opts: PRCreateOptions) => wrap(() => gh.prCreate(opts)));
  ipc.handle(GH.PR_MERGE, (_e, { number, method }: { number: number; method: MergeMethod }) =>
    wrap(() => gh.prMerge(number, method)),
  );
  ipc.handle(GH.PR_CHECKS, (_e, num: number) => wrap(() => gh.prChecks(num)));
  ipc.handle(GH.PR_REVIEW, (_e, opts: PRReviewOptions) => wrap(() => gh.prReview(opts)));
  ipc.handle(GH.REPO_INFO, () => wrap(() => gh.repoInfo()));
  ipc.handle(GH.COLLABORATORS, () => wrap(() => gh.collaborators()));
}
