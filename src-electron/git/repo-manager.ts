import fs from "node:fs";
import path from "node:path";
import { GitExecutor } from "./executor.js";
import { RepoWatcher } from "./watcher.js";
import { AutoFetcher } from "./auto-fetch.js";
import { EVENTS } from "../../src/shared/ipc.js";
import type { UndoState } from "../../src/shared/types.js";

type Sender = (channel: string, payload: unknown) => void;

interface HistoryEntry {
  sha: string;
  // Display label (prettified from `subject`).
  label: string;
  // Raw reflog subject, preserved so we can decide per-transition how
  // to move HEAD (checkout vs reset --soft vs reset --keep).
  subject: string;
}

// Cosmetic: reflog subjects are verbose ("reset: moving to <40-char-sha>")
// and leak noise from past undo sessions into the label the user sees
// in the toast. Normalize the few common forms into something shorter.
function prettifyLabel(subject: string, sha: string): string {
  if (!subject) return sha.slice(0, 7);
  const mCommit = /^commit(?:\s\([^)]+\))?:\s*(.+)$/.exec(subject);
  if (mCommit) return mCommit[1];
  const mReset = /^reset:\s*moving to\s+([0-9a-f]+)/.exec(subject);
  if (mReset) return `reset to ${mReset[1].slice(0, 7)}`;
  const mCheckout = /^checkout:\s*moving from\s+\S+\s+to\s+(\S+)/.exec(subject);
  if (mCheckout) return `checkout ${mCheckout[1]}`;
  return subject;
}

// A single open-repo session: executor + watcher + auto-fetcher. When the
// user closes a tab we dispose just that session's side-effects.
class RepoSession {
  readonly executor: GitExecutor;
  private watcher: RepoWatcher;
  readonly autoFetch: AutoFetcher;

  // Browser-style undo history. `history[0]` is the most recent HEAD
  // (where the user currently is); the cursor walks deeper into the
  // past as the user undoes. Each undo/redo moves the cursor without
  // appending to history; the list is re-seeded from reflog whenever
  // a user action outside undo/redo drifts HEAD off our cursor entry.
  private history: HistoryEntry[] = [];
  private cursor = 0;

  constructor(repoPath: string, send: Sender, autoFetchIntervalMs: number) {
    this.executor = new GitExecutor(repoPath);
    this.watcher = new RepoWatcher(repoPath, (e) =>
      send(EVENTS.REPO_CHANGED, { ...e, repoPath }),
    );
    this.watcher.start();
    this.autoFetch = new AutoFetcher(
      () => this.executor,
      (e) => send(EVENTS.FETCH_COMPLETE, { ...e, repoPath }),
      autoFetchIntervalMs,
      () => send(EVENTS.FETCH_START, { repoPath }),
    );
    this.autoFetch.start();
  }

  get repoPath() {
    return this.executor.repoPath;
  }

  private async softReset(target: string): Promise<void> {
    await this.executor._raw(["reset", "--soft", target]);
  }

  private async checkoutRef(refOrSha: string): Promise<void> {
    await this.executor._raw(["checkout", refOrSha]);
  }

  // Pick the right HEAD-moving command for a given transition. Each
  // reflog entry's subject describes how the user arrived at that
  // HEAD — which is exactly what we need to decide the inverse.
  //
  //   commit*                       → reset --soft (uncommit / redo commit)
  //   checkout: moving from X to Y  → checkout X (undo) / checkout Y (redo)
  //   anything else                 → reset --keep (safe fallback)
  //
  // `newer` is the more recent history entry; `older` is the one we're
  // heading toward on undo (or returning from on redo).
  private async applyTransition(
    newer: HistoryEntry,
    older: HistoryEntry,
    direction: "undo" | "redo",
  ): Promise<void> {
    const subject = newer.subject;

    const mCheckout = /^checkout:\s*moving from\s+(\S+)\s+to\s+(\S+)/.exec(subject);
    if (mCheckout) {
      const [, from, to] = mCheckout;
      await this.checkoutRef(direction === "undo" ? from : to);
      return;
    }

    if (/^commit(?:\s|:|$)|^commit \(/.test(subject)) {
      await this.softReset(direction === "undo" ? older.sha : newer.sha);
      return;
    }

    await this.executor.resetKeep(direction === "undo" ? older.sha : newer.sha);
  }

  // Re-seed history from reflog. Dedupes consecutive no-op entries
  // (our own resets or amend-reflog quirks that leave the same SHA
  // twice in a row) so the cursor always advances to a genuinely
  // different HEAD on undo.
  private async seedHistory(): Promise<void> {
    const raw = await this.executor._raw([
      "reflog",
      "show",
      "--format=%H\x01%gs",
      "-n",
      "200",
      "HEAD",
    ]);
    const lines = raw.split("\n").filter(Boolean);
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      const [sha, subject = ""] = line.split("\x01");
      if (!sha) continue;
      if (entries[entries.length - 1]?.sha === sha) continue;
      entries.push({ sha, subject, label: prettifyLabel(subject, sha) });
    }
    this.history = entries;
    this.cursor = 0;
  }

  // Ensure history is consistent with the real HEAD. If the user
  // committed / checked out / reset outside of undo/redo, the live
  // HEAD will no longer match `history[cursor]` and we re-seed.
  private async ensureFresh(): Promise<void> {
    const head = await this.executor.currentHead();
    if (this.history[this.cursor]?.sha === head) return;
    await this.seedHistory();
  }

  async headUndo(): Promise<{ label: string | null }> {
    await this.ensureFresh();
    const leaving = this.history[this.cursor];
    const target = this.history[this.cursor + 1];
    if (!leaving || !target) throw new Error("Nothing to undo");
    await this.applyTransition(leaving, target, "undo");
    this.cursor += 1;
    return { label: leaving.label || null };
  }

  async headRedo(): Promise<{ label: string | null }> {
    await this.ensureFresh();
    if (this.cursor <= 0) throw new Error("Nothing to redo");
    const restoring = this.history[this.cursor - 1];
    const current = this.history[this.cursor];
    if (!restoring || !current) throw new Error("Nothing to redo");
    await this.applyTransition(restoring, current, "redo");
    this.cursor -= 1;
    return { label: restoring.label || null };
  }

  async undoState(): Promise<UndoState> {
    await this.ensureFresh();
    const leaving = this.history[this.cursor];
    const target = this.history[this.cursor + 1];
    const restoring = this.history[this.cursor - 1];
    return {
      canUndo: !!leaving && !!target,
      canRedo: !!restoring,
      undoLabel: leaving?.label || undefined,
      redoLabel: restoring?.label || undefined,
    };
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
  // Applied to every AutoFetcher — both those already running and any new
  // sessions opened later. The renderer pushes this on startup and whenever
  // the user changes the Settings → Auto-fetch interval dropdown.
  private autoFetchIntervalMs = 5 * 60 * 1000;

  constructor(private readonly send: Sender) {}

  setAutoFetchInterval(ms: number) {
    this.autoFetchIntervalMs = ms;
    for (const s of this.sessions.values()) s.autoFetch.setInterval(ms);
  }

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
      const session = new RepoSession(abs, this.send, this.autoFetchIntervalMs);
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
