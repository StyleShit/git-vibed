import fs from "node:fs";
import path from "node:path";
import { GitExecutor } from "./executor.js";
import { RepoWatcher } from "./watcher.js";
import { AutoFetcher } from "./auto-fetch.js";
import { EVENTS } from "../../src/shared/ipc.js";

type Sender = (channel: string, payload: unknown) => void;

// A single open-repo session: executor + watcher + auto-fetcher. When the
// user closes a tab we dispose just that session's side-effects.
class RepoSession {
  readonly executor: GitExecutor;
  private watcher: RepoWatcher;
  private autoFetch: AutoFetcher;

  constructor(repoPath: string, send: Sender) {
    this.executor = new GitExecutor(repoPath);
    this.watcher = new RepoWatcher(repoPath, (e) =>
      send(EVENTS.REPO_CHANGED, { ...e, repoPath }),
    );
    this.watcher.start();
    this.autoFetch = new AutoFetcher(
      () => this.executor,
      (e) => send(EVENTS.FETCH_COMPLETE, { ...e, repoPath }),
    );
    this.autoFetch.start();
  }

  get repoPath() {
    return this.executor.repoPath;
  }

  async dispose() {
    this.autoFetch.dispose();
    await this.watcher.dispose();
  }
}

// Holds every open repo session keyed by absolute path. There's also an
// "active" key that the renderer keeps in sync with the focused tab —
// handlers without an explicit repoPath route through the active session.
export class RepoManager {
  private sessions = new Map<string, RepoSession>();
  private activeKey: string | null = null;
  private openListeners: Array<(p: string) => void> = [];

  constructor(private readonly send: Sender) {}

  get active(): RepoSession | null {
    return this.activeKey ? this.sessions.get(this.activeKey) ?? null : null;
  }

  get activePath(): string | null {
    return this.active?.repoPath ?? null;
  }

  get openPaths(): string[] {
    return [...this.sessions.keys()];
  }

  get(repoPath: string): RepoSession | null {
    return this.sessions.get(path.resolve(repoPath)) ?? null;
  }

  // Returns the target session: explicit path if provided, else active. Throws
  // when nothing's open so handlers don't have to null-check everywhere.
  require(repoPath?: string): RepoSession {
    const key = repoPath ? path.resolve(repoPath) : this.activeKey;
    const s = key ? this.sessions.get(key) : null;
    if (!s) throw new Error("No repository is currently open");
    return s;
  }

  onRepoOpen(cb: (p: string) => void) {
    this.openListeners.push(cb);
  }

  async open(repoPath: string): Promise<string> {
    const abs = path.resolve(repoPath);
    if (!fs.existsSync(path.join(abs, ".git"))) {
      throw new Error(`Not a git repository: ${abs}`);
    }
    // Reopening an existing session is a no-op — just set it active again.
    if (!this.sessions.has(abs)) {
      const session = new RepoSession(abs, this.send);
      if (!(await session.executor.isRepo())) {
        await session.dispose();
        throw new Error(`Not a git repository: ${abs}`);
      }
      this.sessions.set(abs, session);
    }
    this.activeKey = abs;
    for (const l of this.openListeners) l(abs);
    return abs;
  }

  async close(repoPath: string): Promise<string[]> {
    const abs = path.resolve(repoPath);
    const session = this.sessions.get(abs);
    if (session) {
      await session.dispose();
      this.sessions.delete(abs);
    }
    if (this.activeKey === abs) {
      // Pick any remaining session as the new active so follow-up calls don't
      // land in a "no repo open" state when another tab is actually visible.
      const next = this.sessions.keys().next();
      this.activeKey = next.done ? null : next.value;
    }
    return [...this.sessions.keys()];
  }

  setActive(repoPath: string): string {
    const abs = path.resolve(repoPath);
    if (!this.sessions.has(abs)) throw new Error(`Repo not open: ${abs}`);
    this.activeKey = abs;
    return abs;
  }

  async dispose() {
    for (const s of this.sessions.values()) await s.dispose();
    this.sessions.clear();
    this.activeKey = null;
  }
}
