import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { Branch } from "@shared/types";
import { renderWithRepo } from "../test/renderWithRepo";
import { gitBranchesOptions } from "../queries/gitApi";

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

// Active subscriber so invalidate triggers a refetch (default refetchType
// is "active"). Mirrors how BranchList uses gitBranchesOptions.
function BranchesProbe() {
  useQuery(gitBranchesOptions(REPO));
  return null;
}

describe("checkout → REPO_CHANGED refs event updates branches", () => {
  it("flips isHead to the newly checked-out branch", async () => {
    const before: Branch[] = [branch("main", true), branch("feature", false)];
    const after: Branch[] = [branch("main", false), branch("feature", true)];

    window.__gitApiMock.stub("branches", () => before);

    const { queryClient } = renderWithRepo(<BranchesProbe />, {
      initialTab: { path: REPO },
    });

    await waitFor(() => {
      const bs = queryClient.getQueryData(gitBranchesOptions(REPO).queryKey);
      expect(bs?.find((b) => b.isHead)?.name).toBe("main");
    });

    await window.gitApi.checkout("feature");
    window.__gitApiMock.stub("branches", () => after);
    window.__emitRepoChanged({ repoPath: REPO, type: "refs" });

    await waitFor(() => {
      const bs = queryClient.getQueryData(gitBranchesOptions(REPO).queryKey);
      expect(bs?.find((b) => b.isHead)?.name).toBe("feature");
    });
  });
});
