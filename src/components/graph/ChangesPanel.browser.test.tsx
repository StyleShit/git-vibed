import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { RepoStatus } from "@shared/types";
import { renderWithRepo } from "../../test/renderWithRepo";
import { gitStatusOptions } from "../../queries/gitApi";
import { ChangesPanel } from "./ChangesPanel";

const REPO = "/repo";

function statusWith({
  staged,
  unstaged,
}: {
  staged: string[];
  unstaged: string[];
}): RepoStatus {
  return {
    repoPath: REPO,
    branch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    tracking: null,
    staged: staged.map((path) => ({ path, status: "modified", staged: true })),
    unstaged: unstaged.map((path) => ({ path, status: "modified", staged: false })),
    conflicted: [],
    mergeInProgress: false,
    rebaseInProgress: false,
  };
}

describe("ChangesPanel — REPO_CHANGED updates the panel", () => {
  it("moves a file from Changes to Staged after an index event", async () => {
    const initialStatus = statusWith({ staged: [], unstaged: ["foo.ts"] });
    const afterStage = statusWith({ staged: ["foo.ts"], unstaged: [] });

    // Point the mock at initialStatus before render so the first query
    // fetch lands the expected state; we flip to afterStage before the
    // watcher event fires.
    window.__gitApiMock.stub("status", () => initialStatus);

    const { queryClient } = renderWithRepo(<ChangesPanel />, {
      initialTab: { path: REPO },
    });

    await waitFor(() => {
      expect(screen.getByText(/^Staged \(0\)$/)).not.toBeNull();
      expect(screen.getByText(/^Changes \(1\)$/)).not.toBeNull();
    });
    expect(screen.getByText("foo.ts")).not.toBeNull();

    window.__gitApiMock.stub("status", () => afterStage);
    window.__emitRepoChanged({ repoPath: REPO, type: "index" });

    await waitFor(() => {
      expect(screen.getByText(/^Staged \(1\)$/)).not.toBeNull();
      expect(screen.getByText(/^Changes \(0\)$/)).not.toBeNull();
    });

    const status = queryClient.getQueryData(gitStatusOptions(REPO).queryKey);
    expect(status?.staged.map((f) => f.path)).toEqual(["foo.ts"]);
    expect(status?.unstaged).toEqual([]);
  });

  it("moves a file from Staged back to Changes after unstage", async () => {
    const initialStatus = statusWith({ staged: ["foo.ts"], unstaged: [] });
    const afterUnstage = statusWith({ staged: [], unstaged: ["foo.ts"] });

    window.__gitApiMock.stub("status", () => initialStatus);

    const { queryClient } = renderWithRepo(<ChangesPanel />, {
      initialTab: { path: REPO },
    });

    await waitFor(() => {
      expect(screen.getByText(/^Staged \(1\)$/)).not.toBeNull();
      expect(screen.getByText(/^Changes \(0\)$/)).not.toBeNull();
    });

    window.__gitApiMock.stub("status", () => afterUnstage);
    window.__emitRepoChanged({ repoPath: REPO, type: "index" });

    await waitFor(() => {
      expect(screen.getByText(/^Staged \(0\)$/)).not.toBeNull();
      expect(screen.getByText(/^Changes \(1\)$/)).not.toBeNull();
    });

    const status = queryClient.getQueryData(gitStatusOptions(REPO).queryKey);
    expect(status?.staged).toEqual([]);
    expect(status?.unstaged.map((f) => f.path)).toEqual(["foo.ts"]);
  });
});
