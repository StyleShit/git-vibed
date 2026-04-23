import path from "node:path";
import fs from "node:fs";
import type { GitExecutor } from "./executor.js";
import type { FetchCompleteEvent } from "../../src/shared/types.js";

// Per-session payload — RepoSession adds repoPath before forwarding.
export type AutoFetchEvent = Omit<FetchCompleteEvent, "repoPath">;

// Runs a background `git fetch --all --prune` on an interval. Pauses while a
// merge or rebase is in progress so it can't clobber in-flight work.
export class AutoFetcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private intervalMs: number;

  constructor(
    private readonly getExecutor: () => GitExecutor | null,
    private readonly onComplete: (e: AutoFetchEvent) => void,
    intervalMs: number = 5 * 60 * 1000,
    private readonly onStart: () => void = () => {},
  ) {
    this.intervalMs = intervalMs;
  }

  start() {
    // Kick once shortly after start so the user sees behind counts promptly.
    this.timer = setTimeout(() => this.tick(), 5_000);
  }

  // Apply a new interval at runtime. Reschedules the next tick relative to
  // "now" rather than waiting out the old (potentially very long) interval.
  setInterval(ms: number) {
    if (ms === this.intervalMs) return;
    this.intervalMs = ms;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      if (!this.running) this.schedule();
    }
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
    let started = false;
    try {
      const exec = this.getExecutor();
      if (!exec) return;
      if (this.isBusy(exec)) return;
      started = true;
      this.onStart();
      // Snapshot remote + tag refs so we can report whether the fetch
      // actually moved anything. Failures here shouldn't prevent the fetch
      // itself — fall back to "changed: true" so the renderer still refreshes.
      const before = await exec.refSnapshot().catch(() => null);
      await exec.fetch({ all: true, prune: true });
      const after = await exec.refSnapshot().catch(() => null);
      const changed = before === null || after === null ? true : before !== after;
      const status = await exec.status();
      this.onComplete({ behind: status.behind, ahead: status.ahead, changed });
    } catch (e) {
      // Only emit a "complete" (even a failed one) if we actually started —
      // otherwise the renderer would see a stray completion event for a tick
      // that never ran, which would clear a spinner that was never shown.
      if (started)
        this.onComplete({ behind: 0, ahead: 0, changed: false, errors: String(e) });
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
