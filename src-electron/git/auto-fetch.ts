import path from "node:path";
import fs from "node:fs";
import type { GitExecutor } from "./executor.js";
import type { FetchCompleteEvent } from "../../src/shared/types.js";

// Runs a background `git fetch --all --prune` on an interval. Pauses while a
// merge or rebase is in progress so it can't clobber in-flight work.
export class AutoFetcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly getExecutor: () => GitExecutor | null,
    private readonly onComplete: (e: FetchCompleteEvent) => void,
    private readonly intervalMs: number = 5 * 60 * 1000,
  ) {}

  start() {
    // Kick once shortly after start so the user sees behind counts promptly.
    this.timer = setTimeout(() => this.tick(), 5_000);
  }

  private isBusy(exec: GitExecutor): boolean {
    const gitDir = path.join(exec.repoPath, ".git");
    return (
      fs.existsSync(path.join(gitDir, "MERGE_HEAD")) ||
      fs.existsSync(path.join(gitDir, "rebase-merge")) ||
      fs.existsSync(path.join(gitDir, "rebase-apply"))
    );
  }

  private async tick() {
    if (this.running) {
      this.schedule();
      return;
    }
    this.running = true;
    try {
      const exec = this.getExecutor();
      if (!exec) return;
      if (this.isBusy(exec)) return;
      await exec.fetch({ all: true, prune: true });
      const status = await exec.status();
      this.onComplete({ behind: status.behind, ahead: status.ahead });
    } catch (e) {
      this.onComplete({ behind: 0, ahead: 0, errors: String(e) });
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private schedule() {
    this.timer = setTimeout(() => this.tick(), this.intervalMs);
  }

  // Called from the renderer's "refresh" button as a forced tick.
  async forceTick() {
    if (this.timer) clearTimeout(this.timer);
    await this.tick();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
