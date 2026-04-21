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
import { parseGitLog } from "./parser.js";

const execFileP = promisify(execFile);

// Thin wrapper around simple-git with a handful of escape-hatches into the
// raw git CLI for operations simple-git doesn't expose cleanly (e.g. applying
// a custom patch from stdin, reading a file at a specific ref).
export class GitExecutor {
  readonly repoPath: string;
  private git: SimpleGit;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit({ baseDir: repoPath });
  }

  // ---- Repo / status -----------------------------------------------------

  async isRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
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

  // ---- Commit / log ------------------------------------------------------

  async commit(opts: CommitOptions): Promise<string> {
    const args: string[] = [];
    if (opts.amend) args.push("--amend");
    if (opts.noVerify) args.push("--no-verify");
    if (opts.signOff) args.push("--signoff");
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
      "--format=%H%x01%P%x01%an%x01%ae%x01%at%x01%D%x01%s%x02",
      ...(opts.limit ? [`-n${opts.limit}`] : ["-n500"]),
      ...(opts.skip && opts.skip > 0 ? [`--skip=${opts.skip}`] : []),
      ...(opts.branch && !opts.all ? [opts.branch] : []),
    ];
    const raw = await this.git.raw(args);
    return parseGitLog(raw);
  }

  // ---- Branches ----------------------------------------------------------

  async branches(): Promise<Branch[]> {
    const summary = await this.git.branch(["-a", "-v", "--format=%(refname:short)|%(refname)|%(HEAD)|%(upstream:short)|%(upstream:track)|%(objectname:short)"]);
    // simple-git returns the raw string in summary.all for --format; fall back
    // to calling raw() directly when --format isn't honored by the installed
    // simple-git version.
    let lines: string[];
    try {
      const raw = await this.git.raw([
        "for-each-ref",
        "--format=%(refname:short)|%(refname)|%(HEAD)|%(upstream:short)|%(upstream:track)|%(objectname:short)",
        "refs/heads",
        "refs/remotes",
      ]);
      lines = raw.split("\n").filter(Boolean);
    } catch {
      lines = Object.keys(summary.branches);
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

  async checkout(branch: string): Promise<void> {
    await this.git.checkout(branch);
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

  async stash(message?: string): Promise<void> {
    const args = ["stash", "push"];
    if (message) args.push("-m", message);
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
      const raw = await this.git.raw([
        "stash",
        "list",
        "--format=%gd%x01%ct%x01%gs",
      ]);
      const out: Stash[] = [];
      for (const line of raw.split("\n")) {
        if (!line) continue;
        const [ref, ts, msg] = line.split("\x01");
        if (!ref) continue;
        const m = /stash@\{(\d+)\}/.exec(ref);
        const index = m ? Number(m[1]) : 0;
        // Subject forms: "WIP on <branch>: <hash> <subject>" or "On <branch>: <message>".
        const branchMatch = /^(?:WIP )?[Oo]n ([^:]+):/.exec(msg ?? "");
        out.push({
          index,
          ref,
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

  // ---- Tags --------------------------------------------------------------

  async tags(): Promise<Tag[]> {
    try {
      // type=commit for lightweight, type=tag for annotated. We grab both and
      // the subject for annotated tags (empty for lightweight).
      const raw = await this.git.raw([
        "for-each-ref",
        "--format=%(refname:short)%x01%(objectname)%x01%(objecttype)%x01%(subject)",
        "refs/tags",
      ]);
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
    const args = ["diff", "--no-color", "-U3"];
    if (opts.staged) args.push("--cached");
    if (opts.commitA && opts.commitB) args.push(`${opts.commitA}..${opts.commitB}`);
    else if (opts.commitA) args.push(opts.commitA);
    args.push("--", file);
    return await this.git.raw(args);
  }

  async fileAtRef(ref: string, filePath: string): Promise<string> {
    try {
      return await this.git.raw(["show", `${ref}:${filePath}`]);
    } catch {
      return "";
    }
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

  // Rarely-needed raw runner — kept private so callers go through typed methods.
  async _raw(args: string[]): Promise<string> {
    const { stdout } = await execFileP("git", args, {
      cwd: this.repoPath,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  }
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
