import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import type { Commit } from "@shared/types";
import { renderWithRepo } from "../../test/renderWithRepo";
import { useRepo } from "../../stores/repo";

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

describe("commit → REPO_CHANGED head event refreshes log", () => {
  it("adds the new commit to useRepo.tabs[].commits", async () => {
    const before: Commit[] = [commit("a1", "first")];
    const after: Commit[] = [commit("b2", "new commit", ["a1"]), commit("a1", "first")];

    renderWithRepo(<div data-testid="anchor" />, {
      initialTab: { path: REPO, commits: before },
    });

    expect(useRepo.getState().tabs[0].commits.map((c) => c.hash)).toEqual(["a1"]);

    // Simulate: commit succeeds, watcher then emits a head change.
    await window.gitApi.commit({ message: "new commit" });
    window.__gitApiMock.stub("log", () => after);
    window.__emitRepoChanged({ repoPath: REPO, type: "head" });

    await waitFor(() => {
      const hashes = useRepo.getState().tabs[0].commits.map((c) => c.hash);
      expect(hashes).toEqual(["b2", "a1"]);
    });
  });
});
