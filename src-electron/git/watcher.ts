import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import fs from "node:fs";
import type { RepoChangedEvent } from "../../src/shared/types.js";

// The watcher emits this minimal shape; RepoSession wraps it with repoPath
// before it hits the renderer.
export type WatcherEvent = Pick<RepoChangedEvent, "type">;

// Watches the .git directory only. We intentionally DO NOT watch the working
// tree — chokidar walks every descendant to register fs.watch handles, which
// blows the per-process file-descriptor limit on big repos (EMFILE). The
// renderer polls `git status` on focus/visibility changes to catch plain
// work-tree edits that don't touch .git.
export class RepoWatcher {
  private watcher: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private pending: Set<WatcherEvent["type"]> = new Set();

  constructor(
    private readonly repoPath: string,
    private readonly onChange: (e: WatcherEvent) => void,
  ) {}

  start() {
    const gitDir = path.join(this.repoPath, ".git");
    if (!fs.existsSync(gitDir)) return;

    this.watcher = chokidar.watch(
      [
        path.join(gitDir, "HEAD"),
        path.join(gitDir, "index"),
        // Don't recurse into `refs/` — on huge repos (tens of thousands
        // of loose refs) chokidar opens an fs.watch handle per file and
        // blows the per-process FD limit (EMFILE), which takes the
        // whole main process down. packed-refs covers most of the
        // refs churn after gc, and HEAD/index cover the hot paths.
        path.join(gitDir, "packed-refs"),
        path.join(gitDir, "MERGE_HEAD"),
        path.join(gitDir, "rebase-merge"),
        path.join(gitDir, "rebase-apply"),
      ],
      {
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      },
    );

    this.watcher.on("all", (_event, filePath) => {
      this.queue(this.classify(filePath));
    });

    // Don't let an FS error tear down the process (EMFILE, EACCES, etc.).
    // Swallow at this layer — status polling from the renderer still catches
    // any work-tree drift.
    this.watcher.on("error", (err) => {
      console.warn("[watcher]", String(err));
    });
  }

  private classify(filePath: string): WatcherEvent["type"] {
    const base = path.basename(filePath);
    if (base === "HEAD") return "head";
    if (base === "index") return "index";
    if (filePath.includes(path.sep + "refs" + path.sep) || base === "packed-refs") return "refs";
    return "worktree";
  }

  private queue(type: WatcherEvent["type"]) {
    this.pending.add(type);
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      // Emit a single event per unique type in the window — the renderer
      // refetches based on type so dedup here keeps UI refresh minimal.
      for (const t of this.pending) this.onChange({ type: t });
      this.pending.clear();
    }, 200);
  }

  async dispose() {
    if (this.debounce) clearTimeout(this.debounce);
    try {
      await this.watcher?.close();
    } catch (err) {
      console.warn("[watcher] close failed", String(err));
    }
    this.watcher = null;
  }
}
