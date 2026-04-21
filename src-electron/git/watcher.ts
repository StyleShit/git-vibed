import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import fs from "node:fs";
import type { RepoChangedEvent } from "../../src/shared/types.js";

// Watches the .git directory and emits coarse-grained change events. We only
// care about a few specific files — rebroadcasting every FS event from .git
// would be noisy (e.g. pack writes during a fetch).
export class RepoWatcher {
  private watcher: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private pending: Set<RepoChangedEvent["type"]> = new Set();

  constructor(
    private readonly repoPath: string,
    private readonly onChange: (e: RepoChangedEvent) => void,
  ) {}

  start() {
    const gitDir = path.join(this.repoPath, ".git");
    if (!fs.existsSync(gitDir)) return;

    this.watcher = chokidar.watch(
      [
        path.join(gitDir, "HEAD"),
        path.join(gitDir, "index"),
        path.join(gitDir, "refs"),
        path.join(gitDir, "packed-refs"),
        path.join(gitDir, "MERGE_HEAD"),
        path.join(gitDir, "rebase-merge"),
        path.join(gitDir, "rebase-apply"),
      ],
      {
        ignoreInitial: true,
        depth: 4,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      },
    );

    this.watcher.on("all", (_event, filePath) => {
      this.queue(this.classify(filePath));
    });

    // Also watch the working tree for direct edits so staging status stays
    // in sync. Ignore common noise and the .git dir itself.
    const workTreeWatcher = chokidar.watch(this.repoPath, {
      ignoreInitial: true,
      ignored: (p) => {
        const rel = path.relative(this.repoPath, p);
        if (!rel || rel.startsWith("..")) return false;
        return (
          rel === ".git" ||
          rel.startsWith(".git" + path.sep) ||
          rel.startsWith("node_modules") ||
          rel.startsWith("dist") ||
          rel.startsWith("dist-electron") ||
          rel.startsWith("release")
        );
      },
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 75 },
    });
    workTreeWatcher.on("all", () => this.queue("worktree"));

    // Consolidate both watchers under the same close-on-dispose path.
    const innerClose = this.watcher.close.bind(this.watcher);
    this.watcher.close = async () => {
      await Promise.all([innerClose(), workTreeWatcher.close()]);
    };
  }

  private classify(filePath: string): RepoChangedEvent["type"] {
    const base = path.basename(filePath);
    if (base === "HEAD") return "head";
    if (base === "index") return "index";
    if (filePath.includes(path.sep + "refs" + path.sep) || base === "packed-refs") return "refs";
    return "worktree";
  }

  private queue(type: RepoChangedEvent["type"]) {
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
    await this.watcher?.close();
    this.watcher = null;
  }
}
