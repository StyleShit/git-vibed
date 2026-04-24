import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Commit } from "@shared/types";
import { renderWithRepo } from "../../test/renderWithRepo";
import { gitLogOptions } from "../../queries/gitApi";

const REPO = "/repo";

function commit(hash: string, subject: string, parents: string[] = []): Commit {
  return {
    hash,
    parents,
    author: "Alice",
    email: "alice@example.com",
    timestamp: 1_700_000_000,
    subject,
    refs: [],
  };
}

// Tiny consumer so the query has an active subscriber — invalidateQueries
// only refetches active queries by default, which matches the production
// shape (BranchGraph itself subscribes to gitLogOptions).
function LogProbe() {
  useInfiniteQuery(gitLogOptions(REPO));
  return null;
}

describe("commit → REPO_CHANGED head event refetches the log", () => {
  it("adds the new commit to the log query cache", async () => {
    const before: Commit[] = [commit("a1", "first")];
    const after: Commit[] = [
      commit("b2", "new commit", ["a1"]),
      commit("a1", "first"),
    ];

    window.__gitApiMock.stub("log", () => before);

    const { queryClient } = renderWithRepo(<LogProbe />, {
      initialTab: { path: REPO },
    });

    // Wait for the initial fetch.
    await waitFor(() => {
      const log = queryClient.getQueryData(gitLogOptions(REPO).queryKey);
      const hashes = log?.pages.flat().map((c) => c.hash) ?? [];
      expect(hashes).toEqual(["a1"]);
    });

    await window.gitApi.commit({ message: "new commit" });
    window.__gitApiMock.stub("log", () => after);
    window.__emitRepoChanged({ repoPath: REPO, type: "head" });

    await waitFor(() => {
      const log = queryClient.getQueryData(gitLogOptions(REPO).queryKey);
      const hashes = log?.pages.flat().map((c) => c.hash) ?? [];
      expect(hashes).toEqual(["b2", "a1"]);
    });
  });
});
