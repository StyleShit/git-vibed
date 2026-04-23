import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import type { Branch } from "@shared/types";
import { renderWithRepo } from "../test/renderWithRepo";
import { useRepo } from "./repo";

const REPO = "/repo";

function branch(name: string, isHead: boolean): Branch {
  return {
    name,
    fullName: `refs/heads/${name}`,
    isLocal: true,
    isHead,
    isRemote: false,
    ahead: 0,
    behind: 0,
  };
}

describe("checkout → REPO_CHANGED refs event updates branches", () => {
  it("flips isHead to the newly checked-out branch", async () => {
    const before: Branch[] = [branch("main", true), branch("feature", false)];
    const after: Branch[] = [branch("main", false), branch("feature", true)];

    renderWithRepo(<div />, { initialTab: { path: REPO, branches: before } });

    expect(
      useRepo.getState().tabs[0].branches.find((b) => b.isHead)?.name,
    ).toBe("main");

    // Simulate a checkout then the watcher event fired by the ref update.
    await window.gitApi.checkout("feature");
    window.__gitApiMock.stub("branches", () => after);
    window.__emitRepoChanged({ repoPath: REPO, type: "refs" });

    await waitFor(() => {
      expect(
        useRepo.getState().tabs[0].branches.find((b) => b.isHead)?.name,
      ).toBe("feature");
    });
  });
});
