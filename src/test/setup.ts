import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { RepoChangedEvent } from "@shared/types";
import { useRepo } from "../stores/repo";
import { useUI } from "../stores/ui";
import { createGitApiMock, type GitApiMock } from "./gitApi-mock";

declare global {
  interface Window {
    __gitApiMock: GitApiMock;
    __emitRepoChanged: (e: RepoChangedEvent) => void;
  }
}

const initialRepoState = useRepo.getState();
const initialUIState = useUI.getState();

beforeEach(() => {
  const mock = createGitApiMock();
  window.gitApi = mock.api as unknown as Window["gitApi"];
  window.__gitApiMock = mock;
  window.__emitRepoChanged = (e) => mock.fireRepoChanged(e);

  // Base UI Toast's internal mount flow uses flushSync, which React 19
  // emits as a dev-only warning. It's benign and out of our control;
  // silence just this exact message so the suite can stay noise-free.
  const realError = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    const msg = typeof args[0] === "string" ? args[0] : "";
    if (msg.startsWith("flushSync was called from inside a lifecycle method")) {
      return;
    }
    realError(...args);
  });
});

afterEach(() => {
  // Unmount any rendered tree BEFORE resetting store state — otherwise
  // pending useSyncExternalStore subscribers see the reset as a commit
  // during unmount and React flags the cascading re-render as an
  // "infinite update" false positive.
  cleanup();
  useRepo.setState(initialRepoState, true);
  useUI.setState(initialUIState, true);
  vi.clearAllMocks();
});
