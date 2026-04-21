// Build a "compare/create PR" URL for the common git hosts. Used as a
// fallback when the `gh` CLI isn't available.
export function buildCreatePrUrl(remoteUrl: string, baseBranch: string, headBranch: string): string | null {
  const parsed = parseRemote(remoteUrl);
  if (!parsed) return null;
  const { host, owner, repo } = parsed;
  if (host.includes("github.com")) {
    return `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}?expand=1`;
  }
  if (host.includes("gitlab.com") || host.includes("gitlab")) {
    const params = new URLSearchParams({
      "merge_request[source_branch]": headBranch,
      "merge_request[target_branch]": baseBranch,
    });
    return `https://${host}/${owner}/${repo}/-/merge_requests/new?${params.toString()}`;
  }
  if (host.includes("bitbucket.org")) {
    return `https://bitbucket.org/${owner}/${repo}/pull-requests/new?source=${encodeURIComponent(headBranch)}&dest=${encodeURIComponent(baseBranch)}`;
  }
  return null;
}

// Parse a remote URL in any of:
//   https://github.com/owner/repo.git
//   git@github.com:owner/repo.git
//   ssh://git@github.com/owner/repo
export function parseRemote(url: string): { host: string; owner: string; repo: string } | null {
  const trimmed = url.trim();
  // SCP-like: git@host:owner/repo(.git)
  const scp = trimmed.match(/^([^@]+)@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (scp) {
    return { host: scp[2], owner: scp[3], repo: scp[4].replace(/\.git$/, "") };
  }
  try {
    const u = new URL(trimmed);
    const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length >= 2) {
      return { host: u.host, owner: parts[0], repo: parts.slice(1).join("/") };
    }
  } catch {
    // Fall through.
  }
  return null;
}
