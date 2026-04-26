import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { renderWithRepo } from "../test/renderWithRepo";
import {
  checkoutMutation,
  commitMutation,
  stageMutation,
} from "./mutations";

const REPO = "/repo";

// Acceptance tests for the mutation → IPC wiring. The other browser
// tests cover the inverse leg (REPO_CHANGED → cache refetch); this
// file pins down that mutateAsync actually fires the right window.gitApi
// call with the right arguments before the watcher round-trip.

// Calls mutateAsync once on mount with the given input. Letting the
// effect run via mount keeps the test free of querying buttons inside
// CommitPanel / Toolbar (which carry their own can-do gating logic
// orthogonal to what these tests are about).
function MutationProbe<TResult, TInput>({
  options,
  input,
}: {
  options: UseMutationOptions<TResult, Error, TInput>;
  input: TInput;
}) {
  const mut = useMutation(options);
  if (mut.status === "idle") {
    void mut.mutateAsync(input);
  }
  return null;
}

describe("staging mutation calls gitApi.stage with the right files", () => {
  it("forwards the file list straight through", async () => {
    renderWithRepo(
      <MutationProbe options={stageMutation(REPO)} input={["foo.ts", "bar.ts"]} />,
      { initialTab: { path: REPO } },
    );

    await waitFor(() => {
      expect(window.__gitApiMock.api.stage).toHaveBeenCalledWith([
        "foo.ts",
        "bar.ts",
      ]);
    });
  });
});

describe("commit mutation calls gitApi.commit with the right options", () => {
  it("forwards subject, amend, and noVerify flags", async () => {
    const opts = {
      message: "Subject\n\nDescription body",
      amend: false,
      noVerify: false,
    };
    renderWithRepo(
      <MutationProbe options={commitMutation(REPO)} input={opts} />,
      { initialTab: { path: REPO } },
    );

    await waitFor(() => {
      expect(window.__gitApiMock.api.commit).toHaveBeenCalledWith(opts);
    });
  });
});

describe("checkout mutation calls gitApi.checkout with the target branch", () => {
  it("forwards the branch name", async () => {
    renderWithRepo(
      <MutationProbe options={checkoutMutation(REPO)} input="feature" />,
      { initialTab: { path: REPO } },
    );

    await waitFor(() => {
      expect(window.__gitApiMock.api.checkout).toHaveBeenCalledWith("feature");
    });
  });
});
