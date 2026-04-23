import { simpleGit, type SimpleGit } from "simple-git";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import type {
  Branch,
  CommitFile,
  CommitOptions,
  ConfigEntry,
  FetchOptions,
  FileChange,
  PullOptions,
  PushOptions,
  Remote,
  RepoStatus,
  FileStatus,
  Stash,
  Tag,
  Worktree,
} from "../../src/shared/types.js";
import { parseGitLog, parseUnifiedDiff } from "./parser.js";

const execFileP = promisify(execFile);

// Thin wrapper around simple-git with a handful of escape-hatches into the
// raw git CLI for operations simple-git doesn't expose cleanly (e.g. applying
// a custom patch from stdin, reading a file at a specific ref).
export class GitExecutor {
  readonly repoPath: string;
  private git: SimpleGit;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    // Bump max-buffer so commands like `for-each-ref` or `log` on huge
    // repos don't blow past simple-git's default 10MB and reject. 128MB
    // is generous but still capped — a repo with enough output to
    // exceed this should be paginated, not buffered.
    //
    // Pass the full process.env — simple-git's `.env(k, v)` seeds an empty
    // object, so the spawned git (and the hooks it invokes, e.g. husky →
    // pnpm) would otherwise start with no PATH/HOME/etc. See fix-path.ts
    // for how PATH itself is populated at startup. We strip the env vars
    // that simple-git's argv-parser guards against (editor/pager/ssh
    // hijacking) so callers like Claude Code that pre-set GIT_EDITOR don't
    // trip the check.
    this.git = simpleGit({ baseDir: repoPath, maxConcurrentProcesses: 3 }).env({
      ...sanitizedEnv(),
      GIT_OPTIONAL_LOCKS: "0",
    });
  }

  // ---- Repo / status -----------------------------------------------------

  async isRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  // Snapshot of all remote-tracking refs + tags as "<sha> <refname>" lines.
  // Used by the auto-fetcher to detect whether a fetch moved anything so the
  // renderer can skip a needless reload on a no-op tick.
  async refSnapshot(): Promise<string> {
    return await this.git.raw([
      "for-each-ref",
      "--format=%(objectname) %(refname)",
      "refs/remotes",
      "refs/tags",
    ]);
  }

  async status(): Promise<RepoStatus> {
    const s = await this.git.status();
    const gitDir = path.join(this.repoPath, ".git");
    const mergeInProgress = fs.existsSync(path.join(gitDir, "MERGE_HEAD"));
    const rebaseInProgress =
      fs.existsSync(path.join(gitDir, "rebase-merge")) ||
      fs.existsSync(path.join(gitDir, "rebase-apply"));

    const staged: FileChange[] = s.staged.map((p) => ({
      path: p,
      status: mapIndexStatus(s.files.find((f) => f.path === p)?.index),
      staged: true,
    }));

    const unstaged: FileChange[] = [];
    for (const f of s.files) {
      const inStaged = s.staged.includes(f.path);
      const isUntracked = s.not_added.includes(f.path);
      const isConflicted = s.conflicted.includes(f.path);
      if (isConflicted) continue;
      // A file can have both staged and unstaged changes (staged additions
      // followed by further edits) — report the unstaged portion here.
      if (f.working_dir && f.working_dir !== " ") {
        unstaged.push({
          path: f.path,
          status: isUntracked ? "untracked" : mapWorkTreeStatus(f.working_dir),
          staged: false,
        });
      } else if (!inStaged && !isUntracked) {
        // Shouldn't typically happen but keep defensive.
      }
    }

    const conflicted: FileChange[] = s.conflicted.map((p) => ({
      path: p,
      status: "conflicted",
      staged: false,
    }));

    return {
      repoPath: this.repoPath,
      branch: s.current,
      detached: s.detached,
      ahead: s.ahead,
      behind: s.behind,
      tracking: s.tracking,
      staged,
      unstaged,
      conflicted,
      mergeInProgress,
      rebaseInProgress,
      incomingBranch: readIncomingBranch(gitDir, mergeInProgress, rebaseInProgress),
    };
  }

  // ---- Staging / discard -------------------------------------------------

  async stage(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.git.add(files);
  }

  async unstage(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.git.reset(["HEAD", "--", ...files]);
  }

  async discard(files: string[]): Promise<void> {
    if (files.length === 0) return;
    // For untracked files checkout -- won't help; remove them instead.
    const status = await this.git.status();
    const untracked = files.filter((f) => status.not_added.includes(f));
    const tracked = files.filter((f) => !status.not_added.includes(f));
    if (tracked.length > 0) await this.git.checkout(["--", ...tracked]);
    for (const f of untracked) {
      try {
        fs.rmSync(path.join(this.repoPath, f), { force: true, recursive: true });
      } catch {
        // ignore individual file errors — surfaced by the next status refresh.
      }
    }
  }

  async markResolved(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.git.add(files);
  }

  // Apply a patch directly to the index. Used by hunk-level and line-level
  // staging: the UI builds a patch restricted to the selected region and
  // we apply it with --cached.
  async applyPatch(patch: string, reverse = false): Promise<void> {
    await this.runGitWithStdin(
      ["apply", "--cached", ...(reverse ? ["--reverse"] : []), "--whitespace=nowarn", "-"],
      patch,
    );
  }

  // Hunk/line-level discard. Reverse-apply the patch to the working tree
  // (no --cached) so the selected region is rolled back to HEAD without
  // touching other changes in the file or the index.
  async discardPatch(patch: string): Promise<void> {
    await this.runGitWithStdin(
      ["apply", "--reverse", "--whitespace=nowarn", "-"],
      patch,
    );
  }

  // ---- Commit / log ------------------------------------------------------

  async commit(opts: CommitOptions): Promise<string> {
    const args: string[] = [];
    if (opts.amend) args.push("--amend");
    if (opts.noVerify) args.push("--no-verify");
    args.push("-m", opts.message);
    // simpleGit's commit() escapes message — but we need multiple flags so
    // use raw() to have full control over argv.
    const res = await this.git.raw(["commit", ...args]);
    return res;
  }

  async lastCommitMessage(): Promise<string> {
    try {
      return (await this.git.raw(["log", "-1", "--format=%B"])).trimEnd();
    } catch {
      return "";
    }
  }

  async log(opts: { branch?: string; limit?: number; skip?: number; all?: boolean }) {
    const args = [
      "log",
      ...(opts.all ? ["--all"] : []),
      "--parents",
      "--decorate=full",
      "--date=unix",
      // Subject + body split on \x01, record terminated by \x02. Including
      // the body lets the renderer preload multi-line messages when
      // amending without a second IPC round-trip.
      "--format=%H%x01%P%x01%an%x01%ae%x01%at%x01%D%x01%s%x01%b%x02",
      ...(opts.limit ? [`-n${opts.limit}`] : ["-n500"]),
      ...(opts.skip && opts.skip > 0 ? [`--skip=${opts.skip}`] : []),
      ...(opts.branch && !opts.all ? [opts.branch] : []),
    ];
    // Larger maxBuffer — a single commit with a massive body (dependabot-
    // style multi-kilobyte descriptions) can push a 500-commit page well
    // past simple-git's default 10MB cap.
    const { stdout: raw } = await execFileP("git", args, {
      cwd: this.repoPath,
      maxBuffer: 128 * 1024 * 1024,
    });
    return parseGitLog(raw);
  }

  // ---- Branches ----------------------------------------------------------

  async branches(): Promise<Branch[]> {
    // Use execFile directly so we can set a generous maxBuffer; simple-git's
    // default (~10MB) is too tight for monorepos with tens of thousands of
    // remote refs. Also cap with --count so we never spend minutes waiting
    // on the longest tail of refs — anything over 5000 refs is almost
    // certainly unused branches from abandoned PRs.
    let lines: string[];
    try {
      const { stdout } = await execFileP(
        "git",
        [
          "for-each-ref",
          "--count=5000",
          "--sort=-committerdate",
          "--format=%(refname:short)|%(refname)|%(HEAD)|%(upstream:short)|%(upstream:track)|%(objectname:short)",
          "refs/heads",
          "refs/remotes",
        ],
        { cwd: this.repoPath, maxBuffer: 64 * 1024 * 1024 },
      );
      lines = stdout.split("\n").filter(Boolean);
    } catch {
      lines = [];
    }
    return lines.map((line): Branch => {
      const [name, fullName, head, tracking, track, hash] = line.split("|");
      const isLocal = fullName?.startsWith("refs/heads/") ?? false;
      const isRemote = fullName?.startsWith("refs/remotes/") ?? false;
      const aheadMatch = track?.match(/ahead (\d+)/);
      const behindMatch = track?.match(/behind (\d+)/);
      return {
        name,
        fullName: fullName ?? name,
        isLocal,
        isRemote,
        isHead: head === "*",
        tracking: tracking || undefined,
        ahead: aheadMatch ? Number(aheadMatch[1]) : undefined,
        behind: behindMatch ? Number(behindMatch[1]) : undefined,
        lastCommit: hash,
      };
    });
  }

  async branchCreate(name: string, base?: string): Promise<void> {
    const args = ["branch", name];
    if (base) args.push(base);
    await this.git.raw(args);
  }

  async branchDelete(name: string, force = false): Promise<void> {
    await this.git.raw(["branch", force ? "-D" : "-d", name]);
  }

  async branchRename(oldName: string, newName: string): Promise<void> {
    await this.git.raw(["branch", "-m", oldName, newName]);
  }

  // Set (or clear) a local branch's upstream tracking target. Pass null for
  // `upstream` to unset tracking entirely; otherwise pass a qualified ref
  // like `origin/main`.
  async branchSetUpstream(branch: string, upstream: string | null): Promise<void> {
    if (upstream === null) {
      await this.git.raw(["branch", "--unset-upstream", branch]);
      return;
    }
    await this.git.raw([
      "branch",
      `--set-upstream-to=${upstream}`,
      branch,
    ]);
  }

  async checkout(branch: string): Promise<void> {
    await this.git.checkout(branch);
  }

  // Create a new local branch from an arbitrary start-point and check it
  // out. Typical use: `git checkout -b main origin/main` to land a local
  // tracking copy when the user picks a remote branch from the graph.
  async checkoutCreate(localName: string, startPoint: string): Promise<void> {
    await this.git.raw(["checkout", "-b", localName, startPoint]);
  }

  // Merge / rebase — return conflict list if the operation left a conflict.
  async merge(branch: string): Promise<{ conflicts: string[] }> {
    try {
      await this.git.merge([branch]);
      return { conflicts: [] };
    } catch (e) {
      const status = await this.git.status();
      if (status.conflicted.length > 0) return { conflicts: status.conflicted };
      throw e;
    }
  }

  async mergeAbort(): Promise<void> {
    await this.git.raw(["merge", "--abort"]);
  }

  async rebase(onto: string): Promise<{ conflicts: string[] }> {
    try {
      await this.git.rebase([onto]);
      return { conflicts: [] };
    } catch (e) {
      const status = await this.git.status();
      if (status.conflicted.length > 0) return { conflicts: status.conflicted };
      throw e;
    }
  }

  async rebaseContinue(): Promise<{ conflicts: string[] }> {
    try {
      await this.git.raw(["rebase", "--continue"]);
      return { conflicts: [] };
    } catch (e) {
      const status = await this.git.status();
      if (status.conflicted.length > 0) return { conflicts: status.conflicted };
      throw e;
    }
  }

  async rebaseAbort(): Promise<void> {
    await this.git.raw(["rebase", "--abort"]);
  }

  async rebaseSkip(): Promise<{ conflicts: string[] }> {
    try {
      await this.git.raw(["rebase", "--skip"]);
      return { conflicts: [] };
    } catch (e) {
      const status = await this.git.status();
      if (status.conflicted.length > 0) return { conflicts: status.conflicted };
      throw e;
    }
  }

  async cherryPick(hash: string): Promise<void> {
    await this.git.raw(["cherry-pick", hash]);
  }

  async revert(hash: string): Promise<void> {
    await this.git.raw(["revert", "--no-edit", hash]);
  }

  async reset(target: string, mode: "soft" | "mixed" | "hard"): Promise<void> {
    await this.git.raw(["reset", `--${mode}`, target]);
  }

  async stash(message?: string, files?: string[]): Promise<void> {
    const args = ["stash", "push"];
    if (message) args.push("-m", message);
    // Partial stash — when a file list is provided, git stashes only
    // those paths and leaves the rest in the working tree. Useful for
    // "stash these files" from the changes-panel context menu.
    if (files && files.length > 0) args.push("--", ...files);
    await this.git.raw(args);
  }

  async stashPop(): Promise<void> {
    await this.git.raw(["stash", "pop"]);
  }

  // `git stash list` returns entries like:
  //   stash@{0}: WIP on main: abc1234 Subject
  //   stash@{1}: On feature: custom message
  // Using a custom --format so we can parse author date reliably.
  async stashList(): Promise<Stash[]> {
    try {
      // Include %H so renderer can map a commit hash (e.g. the row the
      // user right-clicked in the graph) back to the right stash entry
      // even when the repo has several stashes stacked.
      const raw = await this.git.raw([
        "stash",
        "list",
        "--format=%gd%x01%H%x01%ct%x01%gs",
      ]);
      const out: Stash[] = [];
      for (const line of raw.split("\n")) {
        if (!line) continue;
        const [ref, hash, ts, msg] = line.split("\x01");
        if (!ref) continue;
        const m = /stash@\{(\d+)\}/.exec(ref);
        const index = m ? Number(m[1]) : 0;
        // Subject forms: "WIP on <branch>: <hash> <subject>" or "On <branch>: <message>".
        const branchMatch = /^(?:WIP )?[Oo]n ([^:]+):/.exec(msg ?? "");
        out.push({
          index,
          ref,
          hash: hash ?? "",
          branch: branchMatch?.[1] ?? null,
          message: msg ?? "",
          timestamp: Number(ts) || 0,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  async stashApply(index: number): Promise<void> {
    await this.git.raw(["stash", "apply", `stash@{${index}}`]);
  }

  async stashDrop(index: number): Promise<void> {
    await this.git.raw(["stash", "drop", `stash@{${index}}`]);
  }

  async stashShow(index: number): Promise<string> {
    try {
      return await this.git.raw(["stash", "show", "-p", `stash@{${index}}`]);
    } catch {
      return "";
    }
  }

  // Parsed flavor of stash show — returns a FileDiff per stashed file so
  // the renderer can reuse the same UnifiedView/SplitView components it
  // uses for commits and WIP diffs instead of rolling its own line
  // renderer.
  async stashShowFiles(index: number): Promise<import("../../src/shared/types.js").FileDiff[]> {
    try {
      const { stdout: raw } = await execFileP(
        "git",
        ["stash", "show", "-p", `stash@{${index}}`, "--no-color"],
        { cwd: this.repoPath, maxBuffer: 64 * 1024 * 1024 },
      );
      const parsed = parseUnifiedDiff(raw);
      return parsed.map((f) => ({
        path: f.path,
        oldPath: f.oldPath,
        binary: f.binary,
        hunks: f.hunks,
        raw: f.raw,
      }));
    } catch {
      return [];
    }
  }

  // ---- Tags --------------------------------------------------------------

  async tags(): Promise<Tag[]> {
    try {
      // Same treatment as branches() — bigger buffer + cap the tail so a
      // repo with 50k tags doesn't freeze the UI on first open. Sort by
      // taggerdate so the 5000 we keep are the most recent.
      const { stdout: raw } = await execFileP(
        "git",
        [
          "for-each-ref",
          "--count=5000",
          "--sort=-taggerdate",
          "--format=%(refname:short)\x01%(objectname)\x01%(objecttype)\x01%(subject)",
          "refs/tags",
        ],
        { cwd: this.repoPath, maxBuffer: 64 * 1024 * 1024 },
      );
      const out: Tag[] = [];
      for (const line of raw.split("\n")) {
        if (!line) continue;
        const [name, commit, type, subject] = line.split("\x01");
        // Git should always emit all four fields; skip anything it didn't so
        // the renderer never has to defend against undefined commit ids.
        if (!name || !commit) continue;
        out.push({
          name,
          commit,
          message: subject || undefined,
          annotated: type === "tag",
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  async tagCreate(name: string, ref: string, message?: string): Promise<void> {
    const args = ["tag"];
    if (message) args.push("-a", name, "-m", message, ref);
    else args.push(name, ref);
    await this.git.raw(args);
  }

  async tagDelete(name: string): Promise<void> {
    await this.git.raw(["tag", "-d", name]);
  }

  // ---- Worktrees ---------------------------------------------------------

  async worktrees(): Promise<Worktree[]> {
    try {
      const raw = await this.git.raw(["worktree", "list", "--porcelain"]);
      const out: Worktree[] = [];
      let current: Partial<Worktree> | null = null;
      const flush = () => {
        if (current && current.path) {
          out.push({
            path: current.path,
            branch: current.branch ?? null,
            commit: current.commit ?? "",
            isMain: out.length === 0,
            isBare: current.isBare ?? false,
            isDetached: current.isDetached ?? false,
            isLocked: current.isLocked ?? false,
            lockReason: current.lockReason,
          });
        }
        current = null;
      };
      for (const line of raw.split("\n")) {
        if (!line) {
          flush();
          continue;
        }
        if (line.startsWith("worktree ")) {
          flush();
          current = { path: line.slice("worktree ".length) };
        } else if (current) {
          if (line.startsWith("HEAD ")) current.commit = line.slice(5);
          else if (line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, "");
          else if (line === "detached") current.isDetached = true;
          else if (line === "bare") current.isBare = true;
          else if (line.startsWith("locked")) {
            current.isLocked = true;
            const reason = line.slice("locked".length).trim();
            if (reason) current.lockReason = reason;
          }
        }
      }
      flush();
      return out;
    } catch {
      return [];
    }
  }

  async worktreeAdd(worktreePath: string, branch: string, createBranch = false): Promise<void> {
    const args = ["worktree", "add"];
    if (createBranch) args.push("-b", branch, worktreePath);
    else args.push(worktreePath, branch);
    await this.git.raw(args);
  }

  async worktreeRemove(worktreePath: string, force = false): Promise<void> {
    const args = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push(worktreePath);
    await this.git.raw(args);
  }

  async worktreeLock(worktreePath: string, reason?: string): Promise<void> {
    const args = ["worktree", "lock"];
    if (reason) args.push("--reason", reason);
    args.push(worktreePath);
    await this.git.raw(args);
  }

  async worktreeUnlock(worktreePath: string): Promise<void> {
    await this.git.raw(["worktree", "unlock", worktreePath]);
  }

  // Per-file numstat + status for a commit. Used by the CommitDetail panel
  // to show "2 modified + 1 added" breakdown plus per-file adds/removes.
  async commitFiles(hash: string): Promise<CommitFile[]> {
    try {
      // `show` with name-status gives status (M/A/D/R…); numstat gives the
      // add/remove counts. Running them together keeps things in sync.
      const raw = await this.git.raw([
        "show",
        "--format=",
        "--name-status",
        "--numstat",
        "-z", // NUL-delimited so filenames with spaces/newlines work.
        hash,
      ]);
      const parts = raw.split("\0").filter((x) => x.length > 0);
      // The -z output interleaves name-status then numstat for the same file,
      // but git emits them in two blocks separated implicitly. Parse by
      // distinguishing tab-count: name-status lines are "S\tpath" (or
      // "R<score>\told\tnew"); numstat lines are "add\trem\tpath".
      const statusByPath = new Map<string, FileStatus>();
      const oldByPath = new Map<string, string>();
      const numByPath = new Map<string, { a: number; r: number }>();
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        // numstat has a leading digit or '-' (binary), name-status has a letter.
        if (/^[0-9-]+\t[0-9-]+\t/.test(p)) {
          const [addS, remS, path] = p.split("\t");
          const a = addS === "-" ? 0 : Number(addS);
          const r = remS === "-" ? 0 : Number(remS);
          numByPath.set(path, { a, r });
        } else if (/^[ACDMRTU]/.test(p)) {
          const [code, ...rest] = p.split("\t");
          const letter = code[0];
          if (letter === "R" || letter === "C") {
            // rename/copy: next two entries are old, new
            const oldPath = parts[++i];
            const newPath = parts[++i];
            statusByPath.set(newPath, letter === "R" ? "renamed" : "added");
            oldByPath.set(newPath, oldPath);
          } else {
            const path = rest[0] ?? parts[++i];
            statusByPath.set(path, letterToStatus(letter));
          }
        }
      }
      const files: CommitFile[] = [];
      const seen = new Set<string>();
      for (const [path, status] of statusByPath) {
        const n = numByPath.get(path) ?? { a: 0, r: 0 };
        files.push({
          path,
          oldPath: oldByPath.get(path),
          status,
          added: n.a,
          removed: n.r,
        });
        seen.add(path);
      }
      for (const [path, n] of numByPath) {
        if (seen.has(path)) continue;
        files.push({ path, status: "modified", added: n.a, removed: n.r });
      }
      return files.sort((a, b) => a.path.localeCompare(b.path));
    } catch {
      return [];
    }
  }

  // ---- Pull / push / fetch ----------------------------------------------

  async pull(opts: PullOptions): Promise<string> {
    const args = ["pull"];
    if (opts.strategy === "rebase") args.push("--rebase");
    else if (opts.strategy === "ff-only") args.push("--ff-only");
    if (opts.remote) args.push(opts.remote);
    if (opts.branch) args.push(opts.branch);
    return await this.git.raw(args);
  }

  async push(opts: PushOptions): Promise<string> {
    const args = ["push"];
    if (opts.force) args.push("--force-with-lease");
    if (opts.setUpstream) args.push("-u");
    if (opts.remote) args.push(opts.remote);
    if (opts.branch) args.push(opts.branch);
    return await this.git.raw(args);
  }

  async fetch(opts: FetchOptions): Promise<string> {
    const args = ["fetch"];
    if (opts.prune ?? true) args.push("--prune");
    if (opts.all ?? !opts.remote) args.push("--all");
    else if (opts.remote) args.push(opts.remote);
    return await this.git.raw(args);
  }

  // Push an arbitrary local branch. For the current branch this is a plain
  // `git push`. For another branch we use a refspec so checkout isn't
  // required. Setup-upstream on first push when no tracking is configured.
  async pushBranch(localBranch: string, force = false): Promise<string> {
    const remote = (await this.configGet(`branch.${localBranch}.remote`)) || "origin";
    const upstream = await this.configGet(`branch.${localBranch}.merge`);
    const remoteRef = upstream ? upstream.replace(/^refs\/heads\//, "") : localBranch;
    const args = ["push"];
    if (force) args.push("--force-with-lease");
    if (!upstream) args.push("-u");
    args.push(remote, `${localBranch}:${remoteRef}`);
    return await this.git.raw(args);
  }

  // Fast-forward a local branch to its tracking upstream without checking it
  // out. If the branch is currently HEAD we fall back to a normal pull since
  // refusing to update refs/heads/<head> is a built-in git guard.
  async pullBranch(localBranch: string): Promise<string> {
    const status = await this.git.status();
    if (status.current === localBranch) {
      return await this.git.raw(["pull", "--ff-only"]);
    }
    const upstream = await this.configGet(`branch.${localBranch}.merge`);
    const remote = await this.configGet(`branch.${localBranch}.remote`);
    if (!remote || !upstream) {
      throw new Error(`${localBranch} has no tracking upstream`);
    }
    // upstream is refs/heads/<name>; strip to the branch-only form that
    // refspec syntax expects.
    const remoteRef = upstream.replace(/^refs\/heads\//, "");
    return await this.git.raw(["fetch", remote, `${remoteRef}:${localBranch}`]);
  }

  // ---- Diff --------------------------------------------------------------

  async diff(file: string, opts: { staged?: boolean; commitA?: string; commitB?: string }): Promise<string> {
    // Untracked files don't show up under plain `git diff` since git hasn't
    // recorded them yet — the renderer was seeing an empty diff (hence
    // the "empty + question mark" state). Detect the untracked case via
    // status and synthesize a diff from /dev/null so every line renders
    // as an addition, which is what the user expects.
    if (!opts.staged && !opts.commitA) {
      try {
        const s = await this.git.status();
        if (s.not_added.includes(file)) {
          return await this.untrackedDiff(file);
        }
      } catch {
        // Fall through to the normal diff path — status was best-effort.
      }
    }
    const args = ["diff", "--no-color", "-U3"];
    if (opts.staged) args.push("--cached");
    if (opts.commitA && opts.commitB) args.push(`${opts.commitA}..${opts.commitB}`);
    else if (opts.commitA) args.push(opts.commitA);
    args.push("--", file);
    return await this.git.raw(args);
  }

  // Render an untracked file as if it were being added. We synthesize the
  // unified-diff output by hand instead of calling `git diff --no-index`,
  // which emits a non-standard header (`diff --git /dev/null b/foo`,
  // without the `a/` prefix) that our shared parser won't recognize.
  // Reading the file directly also lets us bail early on binary blobs
  // using a quick null-byte heuristic.
  private async untrackedDiff(file: string): Promise<string> {
    const abs = path.join(this.repoPath, file);
    let content: Buffer;
    try {
      content = await fs.promises.readFile(abs);
    } catch {
      return "";
    }
    // Directories or dangling symlinks show up as ENOENT / EISDIR above
    // — nothing to render if the read failed.
    const header = [
      `diff --git a/${file} b/${file}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${file}`,
    ].join("\n");
    // Binary heuristic: git uses a similar null-byte scan in the first 8KB
    // before deciding whether to emit "Binary files … differ".
    const sniff = content.subarray(0, Math.min(content.length, 8 * 1024));
    if (sniff.includes(0)) {
      return `${header}\nBinary files /dev/null and b/${file} differ\n`;
    }
    const text = content.toString("utf8");
    if (text.length === 0) return `${header}\n`;
    const hasTrailingNewline = text.endsWith("\n");
    const lines = text.split("\n");
    if (hasTrailingNewline) lines.pop();
    const count = lines.length;
    const body = lines.map((l) => `+${l}`).join("\n");
    const tail = hasTrailingNewline ? "" : "\n\\ No newline at end of file";
    return `${header}\n@@ -0,0 +1,${count} @@\n${body}${tail}\n`;
  }

  async fileAtRef(ref: string, filePath: string): Promise<string> {
    try {
      return await this.git.raw(["show", `${ref}:${filePath}`]);
    } catch {
      return "";
    }
  }

  // Write a repo-relative file. Used by the merge editor to persist the
  // resolved result before calling markResolved.
  async writeFile(filePath: string, content: string): Promise<void> {
    const abs = path.join(this.repoPath, filePath);
    const rel = path.relative(this.repoPath, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("refusing to write outside the repo");
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  // ---- Remotes -----------------------------------------------------------

  async remotes(): Promise<Remote[]> {
    const list = await this.git.getRemotes(true);
    return list.map((r) => ({
      name: r.name,
      fetchUrl: r.refs.fetch,
      pushUrl: r.refs.push || r.refs.fetch,
    }));
  }

  async remoteAdd(name: string, url: string): Promise<void> {
    await this.git.addRemote(name, url);
  }

  async remoteRemove(name: string): Promise<void> {
    await this.git.removeRemote(name);
  }

  async remoteSetUrl(name: string, url: string, push = false): Promise<void> {
    const args = ["remote", "set-url"];
    if (push) args.push("--push");
    args.push(name, url);
    await this.git.raw(args);
  }

  // ---- Config ------------------------------------------------------------

  async configList(): Promise<ConfigEntry[]> {
    try {
      const raw = await this.git.raw(["config", "--list", "--show-origin"]);
      const entries: ConfigEntry[] = [];
      for (const line of raw.split("\n")) {
        if (!line) continue;
        const tabIdx = line.indexOf("\t");
        if (tabIdx < 0) continue;
        const origin = line.slice(0, tabIdx);
        const kv = line.slice(tabIdx + 1);
        const eqIdx = kv.indexOf("=");
        if (eqIdx < 0) continue;
        entries.push({
          key: kv.slice(0, eqIdx),
          value: kv.slice(eqIdx + 1),
          scope: originToScope(origin),
          file: origin.replace(/^file:/, ""),
        });
      }
      return entries;
    } catch {
      return [];
    }
  }

  async configGet(key: string, scope?: "local" | "global" | "system"): Promise<string | null> {
    try {
      const args = ["config"];
      if (scope) args.push(`--${scope}`);
      args.push("--get", key);
      const v = await this.git.raw(args);
      return v.trim();
    } catch {
      return null;
    }
  }

  async configSet(key: string, value: string, scope: "local" | "global"): Promise<void> {
    await this.git.raw(["config", `--${scope}`, key, value]);
  }

  // ---- Low-level helpers -------------------------------------------------

  private runGitWithStdin(args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        args,
        { cwd: this.repoPath, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr?.toString() || err.message));
            return;
          }
          resolve(stdout?.toString() ?? "");
        },
      );
      child.stdin?.end(stdin);
    });
  }

  // ---- Undo / Redo ------------------------------------------------------
  //
  // Both directions funnel through `git reset --keep`, which is safer
  // than `--hard` because git bails out rather than clobber uncommitted
  // local edits. Callers (RepoSession) own the redo stack — the
  // executor stays stateless per-call.

  async currentHead(): Promise<string> {
    return (await this.git.raw(["rev-parse", "HEAD"])).trim();
  }

  // Resolve HEAD@{N} if it exists and differs from the current HEAD. We
  // return `null` rather than throwing so callers can use this to probe
  // "is there something to undo?" without catching.
  async priorReflogSha(): Promise<string | null> {
    try {
      const prior = (await this.git.raw(["rev-parse", "HEAD@{1}"])).trim();
      if (!prior) return null;
      const current = await this.currentHead();
      return prior === current ? null : prior;
    } catch {
      return null;
    }
  }

  // Subject of the most recent HEAD reflog entry ("commit (amend): …",
  // "merge feature", "rebase (finish): returning to …", etc.). Used as
  // the hover hint for the Undo button so the user knows what will be
  // rolled back before clicking.
  async latestReflogSubject(): Promise<string | null> {
    try {
      const raw = await this.git.raw([
        "reflog",
        "-1",
        "--format=%gs",
        "HEAD",
      ]);
      const line = raw.split("\n")[0]?.trim();
      return line || null;
    } catch {
      return null;
    }
  }

  async resetKeep(target: string): Promise<void> {
    await this.git.raw(["reset", "--keep", target]);
  }

  // Rarely-needed raw runner — kept private so callers go through typed methods.
  async _raw(args: string[]): Promise<string> {
    const { stdout } = await execFileP("git", args, {
      cwd: this.repoPath,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  }
}

// Figure out the "other side" branch name for merge/rebase banners and
// pane labels. Uses the same files git itself reads when resuming the
// operation. Returns undefined when we can't confidently extract a name.
function readIncomingBranch(
  gitDir: string,
  mergeInProgress: boolean,
  rebaseInProgress: boolean,
): string | undefined {
  try {
    if (mergeInProgress) {
      // MERGE_MSG typically starts with `Merge branch 'foo'` or
      // `Merge remote-tracking branch 'origin/foo'`.
      const msgPath = path.join(gitDir, "MERGE_MSG");
      if (fs.existsSync(msgPath)) {
        const msg = fs.readFileSync(msgPath, "utf8");
        const m =
          msg.match(/^Merge branch '([^']+)'/m) ||
          msg.match(/^Merge branches ('[^']+'(?:, '[^']+')*)/m) ||
          msg.match(/^Merge remote-tracking branch '([^']+)'/m) ||
          msg.match(/^Merge tag '([^']+)'/m) ||
          msg.match(/^Merge commit '([^']+)'/m);
        if (m && m[1]) return m[1].replace(/^'(.+)'$/, "$1");
      }
      return undefined;
    }
    if (rebaseInProgress) {
      // rebase-merge/head-name or rebase-apply/head-name contains a full
      // ref like `refs/heads/feature`.
      for (const sub of ["rebase-merge", "rebase-apply"]) {
        const p = path.join(gitDir, sub, "head-name");
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, "utf8").trim();
          return raw.replace(/^refs\/heads\//, "");
        }
      }
    }
  } catch {
    // Swallow — status is best-effort; missing branch name is fine.
  }
  return undefined;
}

function mapIndexStatus(code?: string): FileStatus {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "T":
      return "typechange";
    case "U":
      return "conflicted";
    default:
      return "modified";
  }
}

function mapWorkTreeStatus(code: string): FileStatus {
  switch (code) {
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "?":
      return "untracked";
    case "A":
      return "added";
    case "T":
      return "typechange";
    case "U":
      return "conflicted";
    default:
      return "modified";
  }
}

function letterToStatus(l: string): FileStatus {
  switch (l) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "T":
      return "typechange";
    case "U":
      return "conflicted";
    default:
      return "modified";
  }
}

function originToScope(origin: string): "local" | "global" | "system" {
  if (/\.git\/config$/.test(origin)) return "local";
  if (/\/\.gitconfig$/.test(origin) || /\.config\/git\/config$/.test(origin)) return "global";
  return "system";
}

// simple-git's argv-parser rejects a fixed set of env vars that can be used
// to hijack the editor/pager/ssh/askpass git invokes. Claude Code (and some
// CI runners) pre-set GIT_EDITOR=true to suppress interactive editors, which
// is harmless in practice but trips the guard. Strip the full guarded list
// rather than picking at GIT_EDITOR alone.
const UNSAFE_ENV_KEYS = new Set([
  "EDITOR",
  "GIT_ASKPASS",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_EDITOR",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_PAGER",
  "GIT_PROXY_COMMAND",
  "GIT_SEQUENCE_EDITOR",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_TEMPLATE_DIR",
  "PAGER",
  "PREFIX",
  "SSH_ASKPASS",
]);

function sanitizedEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (UNSAFE_ENV_KEYS.has(k.toUpperCase())) continue;
    out[k] = v;
  }
  return out;
}
