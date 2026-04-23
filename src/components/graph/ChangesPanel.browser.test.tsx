import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { RepoStatus } from "@shared/types";
import { renderWithRepo } from "../../test/renderWithRepo";
import { useRepo } from "../../stores/repo";
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

    renderWithRepo(<ChangesPanel />, {
      initialTab: { path: REPO, status: initialStatus },
    });

    // Baseline: one change shown, Staged (0), Changes (1).
    expect(screen.getByText(/^Staged \(0\)$/)).not.toBeNull();
    expect(screen.getByText(/^Changes \(1\)$/)).not.toBeNull();
    expect(screen.getByText("foo.ts")).not.toBeNull();

    // Stub status so the next refresh returns the post-stage state, then
    // fire the watcher event that the listener forwards to refreshStatus.
    window.__gitApiMock.stub("status", () => afterStage);
    window.__emitRepoChanged({ repoPath: REPO, type: "index" });

    await waitFor(() => {
      expect(screen.getByText(/^Staged \(1\)$/)).not.toBeNull();
      expect(screen.getByText(/^Changes \(0\)$/)).not.toBeNull();
    });

    // Store also reflects the move.
    const tab = useRepo.getState().tabs[0];
    expect(tab.status?.staged.map((f) => f.path)).toEqual(["foo.ts"]);
    expect(tab.status?.unstaged).toEqual([]);
  });

  it("moves a file from Staged back to Changes after unstage", async () => {
    const initialStatus = statusWith({ staged: ["foo.ts"], unstaged: [] });
    const afterUnstage = statusWith({ staged: [], unstaged: ["foo.ts"] });

    renderWithRepo(<ChangesPanel />, {
      initialTab: { path: REPO, status: initialStatus },
    });

    expect(screen.getByText(/^Staged \(1\)$/)).not.toBeNull();
    expect(screen.getByText(/^Changes \(0\)$/)).not.toBeNull();

    window.__gitApiMock.stub("status", () => afterUnstage);
    window.__emitRepoChanged({ repoPath: REPO, type: "index" });

    await waitFor(() => {
      expect(screen.getByText(/^Staged \(0\)$/)).not.toBeNull();
      expect(screen.getByText(/^Changes \(1\)$/)).not.toBeNull();
    });

    const tab = useRepo.getState().tabs[0];
    expect(tab.status?.staged).toEqual([]);
    expect(tab.status?.unstaged.map((f) => f.path)).toEqual(["foo.ts"]);
  });
});
