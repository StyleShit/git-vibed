import fs from "node:fs";
import path from "node:path";
import { GitExecutor } from "./executor.js";
import { RepoWatcher } from "./watcher.js";
import { AutoFetcher } from "./auto-fetch.js";
import { EVENTS } from "../../src/shared/ipc.js";

type Sender = (channel: string, payload: unknown) => void;

// Holds the currently-open repo and its side-effects (watcher + auto-fetcher).
// Swapping repos tears down the old ones to avoid leaking watchers.
export class RepoManager {
  private _executor: GitExecutor | null = null;
  private watcher: RepoWatcher | null = null;
  private autoFetch: AutoFetcher | null = null;
  private openListeners: Array<(p: string) => void> = [];

  constructor(private readonly send: Sender) {}

  get executor(): GitExecutor | null {
    return this._executor;
  }

  get repoPath(): string | null {
    return this._executor?.repoPath ?? null;
  }

  onRepoOpen(cb: (p: string) => void) {
    this.openListeners.push(cb);
  }

  async open(repoPath: string): Promise<string> {
    // Resolve symlinks / relative paths so watcher events match the stored path.
    const abs = path.resolve(repoPath);
    if (!fs.existsSync(path.join(abs, ".git"))) {
      throw new Error(`Not a git repository: ${abs}`);
    }
    this.dispose();
    const exec = new GitExecutor(abs);
    if (!(await exec.isRepo())) {
      throw new Error(`Not a git repository: ${abs}`);
    }
    this._executor = exec;
    this.watcher = new RepoWatcher(abs, (e) => this.send(EVENTS.REPO_CHANGED, e));
    this.watcher.start();
    this.autoFetch = new AutoFetcher(
      () => this._executor,
      (e) => this.send(EVENTS.FETCH_COMPLETE, e),
    );
    this.autoFetch.start();
    for (const l of this.openListeners) l(abs);
    return abs;
  }

  dispose() {
    void this.watcher?.dispose();
    this.watcher = null;
    this.autoFetch?.dispose();
    this.autoFetch = null;
    this._executor = null;
  }
}
