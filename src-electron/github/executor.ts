import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Check,
  MergeMethod,
  PRCreateOptions,
  PRReviewOptions,
  PullRequest,
} from "../../src/shared/types.js";

const execFileP = promisify(execFile);

interface RunOpts {
  cwd?: string;
  stdin?: string;
}

// Thin wrapper around the gh CLI. Everything goes through `gh ... --json`
// so we parse typed data rather than scraping text output.
export class GhExecutor {
  constructor(private readonly getCwd: () => string | null) {}

  private async run(args: string[], opts: RunOpts = {}): Promise<string> {
    const cwd = opts.cwd ?? this.getCwd() ?? process.cwd();
    return new Promise((resolve, reject) => {
      const child = execFile(
        "gh",
        args,
        { cwd, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr?.toString() || err.message));
            return;
          }
          resolve(stdout?.toString() ?? "");
        },
      );
      if (opts.stdin) child.stdin?.end(opts.stdin);
    });
  }

  async available(): Promise<boolean> {
    try {
      await execFileP("gh", ["auth", "status"], { cwd: this.getCwd() ?? process.cwd() });
      return true;
    } catch {
      return false;
    }
  }

  async prList(state: "open" | "closed" | "all" = "open"): Promise<PullRequest[]> {
    const fields = [
      "number",
      "title",
      "state",
      "author",
      "url",
      "headRefName",
      "baseRefName",
      "isDraft",
      "reviewDecision",
      "updatedAt",
    ].join(",");
    const raw = await this.run(["pr", "list", "--state", state, "--json", fields, "--limit", "100"]);
    const parsed = JSON.parse(raw) as Array<{
      number: number;
      title: string;
      state: string;
      author: { login: string } | null;
      url: string;
      headRefName: string;
      baseRefName: string;
      isDraft: boolean;
      reviewDecision?: string | null;
      updatedAt: string;
    }>;
    return parsed.map((p) => ({
      number: p.number,
      title: p.title,
      state: p.state as PullRequest["state"],
      author: p.author?.login ?? "unknown",
      url: p.url,
      headRefName: p.headRefName,
      baseRefName: p.baseRefName,
      isDraft: p.isDraft,
      reviewDecision: (p.reviewDecision ?? null) as PullRequest["reviewDecision"],
      updatedAt: p.updatedAt,
    }));
  }

  async prView(num: number): Promise<PullRequest> {
    const fields = [
      "number",
      "title",
      "state",
      "author",
      "url",
      "headRefName",
      "baseRefName",
      "isDraft",
      "reviewDecision",
      "updatedAt",
      "body",
    ].join(",");
    const raw = await this.run(["pr", "view", String(num), "--json", fields]);
    const p = JSON.parse(raw);
    return {
      number: p.number,
      title: p.title,
      state: p.state,
      author: p.author?.login ?? "unknown",
      url: p.url,
      headRefName: p.headRefName,
      baseRefName: p.baseRefName,
      isDraft: p.isDraft,
      reviewDecision: p.reviewDecision ?? null,
      updatedAt: p.updatedAt,
      body: p.body ?? "",
    };
  }

  async prCreate(opts: PRCreateOptions): Promise<PullRequest> {
    const args = [
      "pr",
      "create",
      "--base",
      opts.base,
      "--head",
      opts.head,
      "--title",
      opts.title,
      "--body",
      opts.body ?? "",
    ];
    if (opts.draft) args.push("--draft");
    if (opts.reviewers && opts.reviewers.length > 0) {
      args.push("--reviewer", opts.reviewers.join(","));
    }
    const out = await this.run(args);
    const urlMatch = out.match(/https:\/\/\S+/);
    if (!urlMatch) throw new Error("PR URL not found in gh output");
    const numMatch = urlMatch[0].match(/\/pull\/(\d+)/);
    if (!numMatch) throw new Error("Could not parse PR number from gh output");
    return this.prView(Number(numMatch[1]));
  }

  async prMerge(number: number, method: MergeMethod): Promise<void> {
    const flag = method === "squash" ? "--squash" : method === "rebase" ? "--rebase" : "--merge";
    await this.run(["pr", "merge", String(number), flag, "--delete-branch=false", "--yes"]);
  }

  async prChecks(number: number): Promise<Check[]> {
    try {
      const raw = await this.run([
        "pr",
        "checks",
        String(number),
        "--json",
        "name,state,bucket,link,workflow",
      ]);
      const parsed = JSON.parse(raw) as Array<{
        name: string;
        state: string;
        bucket?: string;
        link?: string;
        workflow?: string;
      }>;
      return parsed.map((c) => ({
        name: c.name,
        state: c.state,
        bucket: c.bucket,
        detailsUrl: c.link,
        workflow: c.workflow,
      }));
    } catch (e) {
      // `gh pr checks` errors when there are no checks yet — treat as empty.
      if (/no checks/i.test(String(e))) return [];
      throw e;
    }
  }

  async prReview(opts: PRReviewOptions): Promise<void> {
    const flag =
      opts.action === "approve"
        ? "--approve"
        : opts.action === "request-changes"
          ? "--request-changes"
          : "--comment";
    const args = ["pr", "review", String(opts.number), flag];
    if (opts.body) args.push("--body", opts.body);
    await this.run(args);
  }

  async repoInfo(): Promise<{ name: string; owner: string; defaultBranch: string; host: string }> {
    const raw = await this.run(["repo", "view", "--json", "name,owner,defaultBranchRef,url"]);
    const parsed = JSON.parse(raw) as {
      name: string;
      owner: { login: string };
      defaultBranchRef: { name: string };
      url: string;
    };
    const host = new URL(parsed.url).host;
    return {
      name: parsed.name,
      owner: parsed.owner.login,
      defaultBranch: parsed.defaultBranchRef.name,
      host,
    };
  }

  async collaborators(): Promise<string[]> {
    const info = await this.repoInfo();
    try {
      const raw = await this.run([
        "api",
        `/repos/${info.owner}/${info.name}/collaborators`,
        "--paginate",
      ]);
      // Multiple JSON arrays may be concatenated when paginating — split and
      // flatten into a single username list.
      const users: string[] = [];
      for (const chunk of splitJsonConcat(raw)) {
        const parsed = JSON.parse(chunk) as Array<{ login: string }>;
        for (const u of parsed) users.push(u.login);
      }
      return [...new Set(users)];
    } catch {
      return [];
    }
  }
}

function splitJsonConcat(raw: string): string[] {
  // Quick and dirty split: look for `][` between arrays emitted by --paginate.
  const parts = raw.split(/\]\s*\n?\s*\[/g);
  if (parts.length === 1) return [raw.trim()];
  return parts.map((p, i) => {
    if (i === 0) return p + "]";
    if (i === parts.length - 1) return "[" + p;
    return "[" + p + "]";
  });
}
